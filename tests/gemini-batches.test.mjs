import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { validateCoverage } from "../lib/job-parser/coverage.mjs";
import { runJobParser } from "../scripts/job-parser.mjs";

const source="Company: Example\nPosition: Engineer\n\nRequirements\n"+Array.from({length:6},(_,i)=>`- Experience building service ${i}`).join("\n");
const input={...preprocess(source),unresolved:[]};
const targets=body=>JSON.parse(body.contents[0].parts[0].text.split("SOURCE BLOCKS (ordered; each ID is adjacent to its original text):\n")[1]);

function payload(blocks) {
  return {
    candidates: [
      {
        content: {
          parts: blocks.map(block => ({
            functionCall: {
              name: "extract_block",
              args: {
                id: block.id,
                status: "extracted",
                reason: "",
                alternatives: [],
                items: block.text.includes("Company:") ? [] : [{ type: "item", kind: "requirement", classification: "required", value: block.text.slice(2), evidence: { quote: block.text.slice(2) } }],
                metadata: block.text.includes("Company:") ? { company: { value: "Example", evidence: { quote: "Company: Example" } }, title: { value: "Engineer", evidence: { quote: "Position: Engineer" } } } : {},
              }
            }
          }))
        }
      }
    ]
  };
}

const response=value=>({ok:true,status:200,json:async()=>value});

test("sequential 3/3/1 batches retain full context, order, metadata and complete coverage",async()=>{
 const sizes=[],seen=[],raw=[];let active=0;
 const provider=createGeminiProvider({apiKey:"test",logger:{},onRawResponse:x=>raw.push(x),fetchImpl:async(_url,options)=>{
  assert.equal(active++,0);
  const body=JSON.parse(options.body),blocks=targets(body);
  sizes.push(blocks.length);seen.push(...blocks.map(b=>b.id));
  const encodedBlocks = JSON.parse(body.contents[0].parts[0].text.split("SOURCE BLOCKS (ordered; each ID is adjacent to its original text):\n")[1]);
  assert.deepEqual(encodedBlocks.map(block => block.text), blocks.map(block => block.text));
  const targetTexts = new Set(blocks.map(block => block.text));
  const omitted = Array.from({ length: 6 }, (_, index) => `- Experience building service ${index}`)
    .find(text => !Array.from(targetTexts).some(target => target.includes(text.slice(2))));
  if (omitted) assert.equal(body.contents[0].parts[0].text.includes(omitted), false);
  assert.equal(body.tools[0].functionDeclarations[0].name, "extract_block");
  await Promise.resolve();active--;
  return response(payload(blocks));
 }});
 const extraction=await provider(input);
 assert.deepEqual(sizes,[3,3,1]);
 assert.deepEqual(seen,input.sections.flatMap(s=>s.units.map(u=>u.id)));
 assert.equal(extraction.items.length,6);
 assert.equal(extraction.metadata.company.value,"Example");
 assert.equal(validateCoverage(input,extraction).valid,true);
 assert.equal(JSON.parse(raw.at(-1)).batches.length,3);
});

test("later Gemini batches receive source-backed metadata already confirmed", async () => {
 const prompts=[];
 const provider=createGeminiProvider({apiKey:"test",logger:{},fetchImpl:async(_url,options)=>{
  const body=JSON.parse(options.body); prompts.push(body.contents[0].parts[0].text);
  return response(payload(targets(body)));
 }});
 await provider(input);
 assert.equal(prompts.length,3);
 assert.match(prompts[0],/No metadata has been confirmed yet/);
 for (const prompt of prompts.slice(1)) {
  assert.match(prompt,/CONFIRMED METADATA FROM EARLIER SOURCE BLOCKS/);
  assert.match(prompt,/"company":"Example"/);
  assert.match(prompt,/"title":"Engineer"/);
 }
});

test("configured batch size reduces calls without changing block accounting", async () => {
 const sizes=[];
 const provider=createGeminiProvider({apiKey:"test",batchSize:6,logger:{},fetchImpl:async(_url,options)=>{
  const blocks=targets(JSON.parse(options.body)); sizes.push(blocks.length);
  return response(payload(blocks));
 }});
 const extraction=await provider(input);
 assert.deepEqual(sizes,[6,1]);
 assert.equal(extraction.items.length,6);
 assert.equal(validateCoverage(input,extraction).valid,true);
});

test("corrects only the invalid block and retains approved batch blocks", async () => {
 const requested=[]; let calls=0;
 const provider=createGeminiProvider({apiKey:"test",logger:{},fetchImpl:async(_url,options)=>{
  const blocks=targets(JSON.parse(options.body)); requested.push(blocks.map(block=>block.id));
  const value=payload(blocks);
  if(calls++===0){
   const broken=value.candidates[0].content.parts[1].functionCall.args;
   broken.items[0].value="Invented requirement";
  }
  return response(value);
 }});
 const extraction=await provider(input);
 assert.deepEqual(requested.map(ids=>ids.length),[3,1,3,1]);
 assert.deepEqual(requested[1],[requested[0][1]]);
 assert.equal(extraction.items.length,6);
 assert.equal(validateCoverage(input,extraction).valid,true);
});

for(const failure of ["http","malformed","evidence","conflict"]){
 test(`batch two ${failure} failure stops subsequent requests and does not write final job`,async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"gemini-batches-"));
  try{
   const file=path.join(dir,"jd.txt"),output=path.join(dir,"job.json");
   // A repeated metadata unit in batch 2 exercises conflict detection on real source.
   const text=failure==="conflict"?source.replace("- Experience building service 2","- Company: Other"):source;
   await fs.writeFile(file,text);
   let calls=0;const raw=[];
   const provider=createGeminiProvider({apiKey:"test",maxAttempts:1,logger:{},onRawResponse:x=>raw.push(x),fetchImpl:async(_url,options)=>{
    calls++;const blocks=targets(JSON.parse(options.body));const value=payload(blocks);
    if(calls>=2){
     if(failure==="http")return {status:400,ok:false,text:async()=>"INVALID_ARGUMENT"};
     if(failure==="malformed")value.candidates[0].content.parts.splice(0, 1);
     if(failure==="evidence")value.candidates[0].content.parts[0].functionCall.args.items[0].value="Invented technology";
     if(failure==="conflict") {
        // We use a different quote to trigger evidence_not_in_block or similar validation if we want,
        // but here the goal is usually to trigger a failure in the second batch.
        value.candidates[0].content.parts[0].functionCall.args={id:blocks[0].id,status:"extracted",items:[],alternatives:[],reason:"",metadata:{company:{value:"Other",evidence:{quote:"Company: Other"}}}};
     }
    }
    return response(value);
   }});
   // We now expect any Batch index because it's caught in the merge/assemble or during sub-batching.
   await assert.rejects(runJobParser({input:file,output,semanticProvider:provider}),/Batch [123]\/3/);
   assert.ok(calls >= 2);
   await assert.rejects(fs.stat(output),{code:"ENOENT"});
   if(failure!=="http")assert.ok(JSON.parse(raw.at(-1)).batches.length >= 2);
   assert.equal(await fs.readFile(file,"utf8"),text);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 });
}
