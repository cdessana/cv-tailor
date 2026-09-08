import test from "node:test";
import assert from "node:assert/strict";
import { runSmokeTest } from "../scripts/job-parser-smoke.mjs";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";

const metadataValue=value=>({value,evidence:{quote:value}});
function fixture(blocks) {
  return {blocks:Object.fromEntries(blocks.map((block,index)=>[block.id,{
    status:"extracted",reason:"",metadata:index===0?{company:metadataValue("Example"),title:metadataValue("Engineer")}:{},
    items:index===1?[{type:"item",value:"Node.js",kind:"skill",classification:"required",evidence:{quote:"Node.js is required"}}]:[],
    alternatives:index===2?[{type:"alternative",operator:"anyOf",values:["Java","Kotlin"],kind:"skill",classification:"preferred",evidence:{quote:"Java or Kotlin is preferred"}}]:[],
  }]))};
}

test("smoke test exercises production schema, assembly, evidence and mapping offline",async()=>{
  const provider=createGeminiProvider({apiKey:"test",logger:{},fetchImpl:async(_url,options)=>{
    const body=JSON.parse(options.body);
    const schema=JSON.stringify(body.generationConfig.responseJsonSchema);
    assert.equal(/"(?:anyOf|oneOf|allOf)":/u.test(schema),false);
    const blocks=JSON.parse(body.contents[0].parts[0].text.split("SOURCE BLOCKS (ordered; each ID is adjacent to its original text):\n")[1]);
    return {status:200,ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(fixture(blocks))}]}}]})};
  }});
  const job=await runSmokeTest({provider});
  assert.deepEqual(job.requirements.required,["Node.js"]);
  assert.deepEqual(job.alternativeRequirements[0].values,["Java","Kotlin"]);
});

test("smoke test preserves request rejection diagnosis",async()=>{
  const provider=createGeminiProvider({apiKey:"test",logger:{},fetchImpl:async()=>({status:400,ok:false,text:async()=>"INVALID_ARGUMENT"})});
  await assert.rejects(runSmokeTest({provider}),/GEMINI_REQUEST_ERROR.*400.*INVALID_ARGUMENT/);
});

test("smoke test rejects successful but incomplete extraction",async()=>{
  await assert.rejects(runSmokeTest({provider:async()=>({metadata:{company:metadataValue("Example"),title:metadataValue("Engineer")},items:[]})}),/SMOKE_CONTENT_ERROR/);
});
