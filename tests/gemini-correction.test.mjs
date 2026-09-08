import test from "node:test";
import assert from "node:assert/strict";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";
import { preprocessJobDescription } from "../lib/job-parser/preprocess.mjs";
const document=preprocessJobDescription("Unclassified source paragraph");
const id=document.sections[0].units[0].id;
const empty={blocks:{[id]:{status:"extracted",items:[],alternatives:[],metadata:{},reason:""}}};
const corrected={blocks:{[id]:{status:"excluded",items:[],alternatives:[],metadata:{},reason:"Section heading only."}}};
const response=x=>({status:200,ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(x)}]}}]})});

test("one correction includes exact empty-block feedback and retains both raw attempts",async()=>{
 const requests=[],raw=[];
 const provider=createGeminiProvider({apiKey:"test",logger:{},onRawResponse:x=>raw.push(x),fetchImpl:async(_url,options)=>{
  requests.push(JSON.parse(options.body));return response(requests.length===1?empty:corrected);
 }});
 const result=await provider(document);
 assert.equal(requests.length,2);
 assert.deepEqual(requests[0].generationConfig,requests[1].generationConfig);
 assert.deepEqual(requests[0].contents[0],requests[1].contents[0]);
 assert.match(requests[1].contents[1].parts[0].text,/marked extracted but has no items or metadata/);
 assert.match(requests[1].contents[1].parts[0].text,new RegExp(id));
 assert.equal(result.coverage[0].status,"excluded");
 const attempts=JSON.parse(raw.at(-1)).batches;
 assert.deepEqual(attempts.map(x=>x.attempt),[1,2]);
 assert.deepEqual(JSON.parse(JSON.parse(attempts[0].response).candidates[0].content.parts[0].text),empty);
 assert.deepEqual(JSON.parse(JSON.parse(attempts[1].response).candidates[0].content.parts[0].text),corrected);
});

test("invalid correction stops after two responses without silently excluding",async()=>{
 let calls=0;
 const provider=createGeminiProvider({apiKey:"test",logger:{},fetchImpl:async()=>{calls++;return response(empty);}});
 await assert.rejects(provider(document),/Batch 1\/1.*no items or metadata/);
 assert.equal(calls,2);
});

test("HTTP rejection does not trigger semantic correction",async()=>{
 let calls=0;
 const provider=createGeminiProvider({apiKey:"test",logger:{},fetchImpl:async()=>{calls++;return {status:400,ok:false,text:async()=>"INVALID_ARGUMENT"};}});
 await assert.rejects(provider(document),/GEMINI_REQUEST_ERROR/);
 assert.equal(calls,1);
});

test("correction receives block errors and every capitalization or rewritten-verb error together", async () => {
 const source = preprocessJobDescription("The team builds and operates services.\n\nYou will design systems and handle transfers.");
 const units = source.sections.flatMap(section => section.units);
 const makeItem = (value, quote) => ({ type: "item", kind: "responsibility", classification: "not-applicable", value, evidence: { quote } });
 const block = items => ({ status: "extracted", items, alternatives: [], metadata: {}, reason: "" });
 const bad = { blocks: {
  [units[0].id]: block([makeItem("Build and operate services", units[0].originalText)]),
  [units[1].id]: block([
   makeItem("Design systems", units[1].originalText),
   makeItem("Handle transfers", units[1].originalText),
   makeItem("services", units[0].originalText),
  ]),
 }};
 const fixed = { blocks: {
  [units[0].id]: block([makeItem("builds and operates services", units[0].originalText)]),
  [units[1].id]: block([makeItem("design systems", units[1].originalText), makeItem("handle transfers", units[1].originalText)]),
 }};
 const snapshot = structuredClone(bad);
 const requests = [];
 const provider = createGeminiProvider({ apiKey: "test", logger: {}, fetchImpl: async (_url, options) => {
  requests.push(JSON.parse(options.body));
  return response(requests.length === 1 ? bad : fixed);
 }});
 const result = await provider(source);
 assert.equal(requests.length, 2);
 const feedback = requests[1].contents[1].parts[0].text;
 for (const value of ["Build and operate services", "Design systems", "Handle transfers", "evidence_not_in_block", ...units.map(unit => unit.id)]) assert.ok(feedback.includes(value), value);
 assert.match(feedback, /preserving capitalization and verb forms/);
 assert.equal(result.items.length, 3);
 assert.deepEqual(bad, snapshot);
});
