import test from "node:test";
import assert from "node:assert/strict";
import { decodeGeminiResponse } from "../lib/job-parser/providers/gemini-response.mjs";
import { createGeminiProvider } from "../lib/job-parser/providers/gemini.mjs";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { mapToJob } from "../lib/job-parser/map-to-job.mjs";
import { validateEvidence } from "../lib/job-parser/validate-evidence.mjs";
import { normalizeExtraction } from "../lib/job-parser/normalize.mjs";
import { validateAlternativeSemantics } from "../lib/job-requirements/alternatives.mjs";

const item = value => ({ type: "item", kind: "requirement", classification: "required", value, evidence: { quote: value } });
const record = value => ({ value, evidence: { quote: value } });
const block = (items = [], metadata = {}) => ({ status: "extracted", items, alternatives: [], metadata, reason: "" });
const call = (id, value) => ({ functionCall: { name: "extract_block", args: { id, ...value } } });
const payload = parts => ({ candidates: [{ content: { parts } }] });
const response = body => ({ status: 200, ok: true, json: async () => body });

for (const [name, parts, pattern] of [
  ["duplicate", [call("a", block([item("Java")])), call("a", block([item("SQL")]))], /Duplicate/],
  ["unknown ID", [call("b", block())], /Unknown/],
  ["missing ID", [], /Expected/],
  ["wrong function", [{functionCall:{name:"other",args:{id:"a"}}}], /function name/],
  ["null arguments", [{functionCall:{name:"extract_block",args:null}}], /arguments/],
  ["array arguments", [{functionCall:{name:"extract_block",args:[]}}], /arguments/],
]) test(`decoder rejects ${name} without losing records`, () => {
  assert.throws(() => decodeGeminiResponse(payload(parts), ["a"]), pattern);
});

test("missing calls are reported, never fabricated as exclusions", () => {
  assert.throws(() => decodeGeminiResponse(payload([call("a",block())]), ["a","b"]), /missing blocks: b/);
});

test("all records survive valid decoding and raw payload is untouched", () => {
  const raw = payload([call("a", block([item("Java"), item("SQL")]))]);
  const original = structuredClone(raw);
  assert.equal(decodeGeminiResponse(raw,["a"]).blocks.a.items.length, 2);
  assert.deepEqual(raw,original);
});

test("normalized navigation blocks survive merging and raw artifacts stay raw", async () => {
  const document=preprocess("Apply now\n\nJava\n\nSQL\n\nPython");
  const units=document.sections.flatMap(s=>s.units);
  const logs=[],raw=[];
  const provider=createGeminiProvider({apiKey:"test",debug:false,logger:{warn:x=>logs.push(x),debug:()=>assert.fail("debug must be opt-in")},onRawResponse:x=>raw.push(x),fetchImpl:async(_url,options)=>{
    const blocks=JSON.parse(JSON.parse(options.body).contents[0].parts[0].text.split("SOURCE BLOCKS (ordered; each ID is adjacent to its original text):\n")[1]);
    return response(payload(blocks.map(b=>call(b.id,block(b.text==="Apply now"?[]:[item(b.text)])))));
  }});
  const extraction=await provider(document);
  assert.deepEqual(extraction.items.map(x=>x.value),["Java","SQL","Python"]);
  assert.equal(extraction.coverage.find(x=>x.unitId===units[0].id).status,"excluded");
  assert.match(logs[0],/empty_block_excluded/);
  assert.equal(JSON.parse(JSON.parse(raw.at(-1)).batches[0].response).candidates[0].content.parts[0].functionCall.args.status,"extracted");
});

test("short qualifications beneath unknown headings are not silently excluded", async () => {
  const document=preprocess("## Candidate profile\nJava experience");
  const id=document.sections[0].units[0].id;
  let calls=0;
  const provider=createGeminiProvider({apiKey:"test",logger:{},fetchImpl:async()=>{calls++;return response(payload([call(id,block())]));}});
  await assert.rejects(provider(document),/no items or metadata/);
  assert.equal(calls,3);
});

test("malformed block arrays fail shape validation before normalization", async () => {
  const document=preprocess("Apply now");
  const malformed=block();delete malformed.items;
  const provider=createGeminiProvider({apiKey:"test",logger:{},fetchImpl:async()=>response(payload([call(document.sections[0].units[0].id,malformed)]))});
  await assert.rejects(provider(document),error=>error.code==="GEMINI_SCHEMA_ERROR" && /required/.test(error.message) && !/Cannot read/.test(error.message));
});

for (const context of ["Java and SQL are required", "Java, SQL", "Java / SQL", "Java; SQL"]) test(`no choice inferred from ${context}`,()=>{
  assert.throws(()=>validateAlternativeSemantics({kind:"skill",values:["Java","SQL"],context}),/explicit choice/);
});
for (const context of ["Java or SQL", "Java ou SQL", "Java e/ou SQL", "Java ou ferramentas similares"]) test(`explicit choice preserved: ${context}`,()=>{
  assert.doesNotThrow(()=>validateAlternativeSemantics({kind:"skill",values:["Java","SQL"],context}));
});

test("metadata candidates survive mapping with human-review warnings; fabricated candidates fail",async()=>{
  const document=preprocess("Example\nEngineer\n\nLondon\n\nParis\n\nOther");
  const provider=createGeminiProvider({apiKey:"test",logger:{},fetchImpl:async(_url,options)=>{
    const blocks=JSON.parse(JSON.parse(options.body).contents[0].parts[0].text.split("SOURCE BLOCKS (ordered; each ID is adjacent to its original text):\n")[1]);
    return response(payload(blocks.map(b=>call(b.id,block([],b.text.includes("Engineer")?{company:record("Example"),title:record("Engineer")}:b.text==="Other"?{company:record("Other")}:{location:record(b.text)})))));
  }});
  const extraction=await provider(document);
  const snapshot=structuredClone(extraction);
  const mapped=mapToJob(normalizeExtraction(extraction));
  assert.equal(mapped.valid,true);
  assert.equal(mapped.job.location,"London");
  assert.equal(mapped.job.company,"Example");
  assert.equal(mapped.warnings.length,2);
  assert.ok(mapped.warnings.every(w=>w.requiresHumanValidation && /Human validation required/.test(w.message) && w.selected.evidence && w.candidates.length===2));
  assert.deepEqual(extraction,snapshot);
  extraction.metadata.location.candidates.push(record("Atlantis"));
  assert.equal(validateEvidence(document,extraction).valid,false);
});

test("example grouping never truncates a qualification; unrelated examples preserve genuine choices", () => {
  const metadata={company:record("Example"),title:record("Engineer")};
  const alternative=(values,quote)=>({type:"alternative",operator:"anyOf",kind:"requirement",classification:"required",values,evidence:{quote}});
  const bad=mapToJob({metadata,items:[alternative(["Postgres","MySQL"],"Experience with databases like Postgres and MySQL, and transaction design")]});
  assert.equal(bad.valid,false);
  assert.equal(bad.job,null);
  const good=mapToJob({metadata,items:[alternative(["Java","Kotlin"],"Java or Kotlin experience and tools like Grafana are useful")]});
  assert.equal(good.valid,true);
  assert.deepEqual(good.job.alternativeRequirements[0].values,["Java","Kotlin"]);
});

test("optional metadata conflicts also require human review", () => {
  const metadata={company:record("Example"),title:record("Engineer"),
    employmentType:{...record("Full-time"),candidates:[record("Full-time"),record("Contract")]},
    sourceUrl:{...record("https://example.test/a"),candidates:[record("https://example.test/a"),record("https://example.test/b")]}};
  const mapped=mapToJob({metadata,items:[]});
  assert.equal(mapped.valid,true);
  assert.deepEqual(mapped.warnings.map(w=>w.path),["/metadata/employmentType","/metadata/sourceUrl"]);
  assert.ok(mapped.warnings.every(w=>w.requiresHumanValidation));
});
