import test from "node:test";
import assert from "node:assert/strict";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { validateCoverage } from "../lib/job-parser/coverage.mjs";
import { validateEvidence } from "../lib/job-parser/validate-evidence.mjs";
import { semanticExtract } from "../lib/job-parser/semantic-extract.mjs";
import { mapToJob } from "../lib/job-parser/map-to-job.mjs";

const item = (value, classification = "required", kind = "requirement") => ({ type: "item", value, kind, classification, evidence: { quote: value } });
const metadata = { company: { value: "Example", evidence: { quote: "Example" } }, title: { value: "Engineer", evidence: { quote: "Engineer" } } };
const document = preprocess("Requirements\n- Database knowledge\n- AI fluency\n\nBenefits:\n- Paid leave");
const units = document.sections.flatMap(s => s.units);
const extraction = { items: [item("Database knowledge"), item("AI fluency")], coverage: [
  { unitId: units[0].id, status: "extracted", itemIndices: [0] },
  { unitId: units[1].id, status: "extracted", itemIndices: [1] },
  { unitId: units[2].id, status: "excluded", reason: "Paid leave is a benefit, not a candidate qualification." },
] };

test("stable source IDs and valid accounting leave inputs unchanged", () => {
  assert.deepEqual(preprocess(document.originalText), document);
  assert.equal(new Set(units.map(u=>u.id)).size, units.length);
  for (const unit of units) assert.equal(document.originalText.slice(unit.start,unit.end),unit.originalText);
  const before = structuredClone(extraction);
  assert.equal(validateCoverage(document,extraction,{required:true}).valid,true);
  assert.deepEqual(extraction,before);
});

for (const [name, change, code] of [
  ["missing accounting", x=>delete x.coverage,"missing_coverage"],
  ["omitted source unit",x=>x.coverage.splice(1,1),"unaccounted_unit"],
  ["unknown unit",x=>x.coverage[0].unitId="invented","unknown_unit"],
  ["duplicate decision",x=>x.coverage.push(x.coverage[0]),"duplicate_unit"],
  ["bad index",x=>x.coverage[0].itemIndices=[99],"invalid_item_reference"],
  ["unrelated evidence",x=>x.coverage[0].itemIndices=[1],"unrelated_item_reference"],
  ["unresolved qualification",x=>x.coverage[0]={unitId:units[0].id,status:"unresolved",reason:"Cannot determine classification."},"unresolved_unit"],
]) test(`coverage rejects ${name}`,()=>{
  const copy=structuredClone(extraction);change(copy);
  const result=validateCoverage(document,copy,{required:true});
  assert.equal(result.valid,false);
  assert.ok(result.errors.some(error=>error.code===code));
});

test("coverage rejects malformed decisions and blank exclusions",()=>{
  for(const entry of [
    {unitId:units[0].id,status:"excluded",reason:" "},
    {unitId:units[0].id,status:"extracted",itemIndices:[]},
    {unitId:units[0].id,status:"extracted",itemIndices:[0,0]},
    {unitId:units[0].id,status:"extracted",itemIndices:[-1]},
    {unitId:units[0].id,status:"excluded",reason:"Benefits",extra:true},
  ]) assert.throws(()=>validateCoverage(document,{items:[],coverage:[entry]}),/Invalid intermediate/);
});

test("optional legacy coverage and explicit unresolved blocking",async()=>{
  assert.equal(validateCoverage(document,{items:[]}).valid,true);
  const copy=structuredClone(extraction);
  copy.coverage[0]={unitId:units[0].id,status:"unresolved",reason:"Unclear classification"};
  await assert.rejects(semanticExtract(document,{items:[]},async()=>copy),/coverage validation failed/);
});

test("remote is not employmentType, but valid employment terms pass",()=>{
  for(const value of ["100% Remote","100% remote work","hybrid","Presencial","Full-time","Contract"]){
    const result=validateEvidence(preprocess(value),{items:[],metadata:{employmentType:{value,evidence:{quote:value}}}});
    assert.equal(result.valid,["Full-time","Contract"].includes(value));
  }
});

test("Pride stack context does not establish mandatory experience",()=>{
  const doc=preprocess("🛠 Tech Stack:\nRuby OR Python\n\nRequirements\nExperience with Ruby OR Elixir");
  const group={type:"alternative",operator:"anyOf",values:["Ruby","Python"],kind:"skill",classification:"required",evidence:{quote:"Ruby OR Python"}};
  assert.equal(validateEvidence(doc,{items:[group]}).errors[0].code,"stack_not_requirement");
  const explicit={...group,values:["Ruby","Elixir"],evidence:{quote:"Experience with Ruby OR Elixir"}};
  assert.equal(validateEvidence(doc,{items:[explicit]}).valid,true);
});

test("equivalent alternatives retain fuller qualification evidence in either order",async()=>{
  const doc=preprocess("Java OR Kotlin\n\nStrong experience with Java or Kotlin and Python.");
  const group=quote=>({type:"alternative",operator:"anyOf",values:["Java","Kotlin"],kind:"skill",classification:"required",evidence:{quote}});
  const short=group("Java OR Kotlin"), full=group("Strong experience with Java or Kotlin and Python.");
  for(const items of [[short,full],[full,short]]){
    const merged=await semanticExtract(doc,{items:[]},async()=>({items}));
    assert.equal(merged.items.length,1);
    assert.equal(merged.items[0].evidence.quote,full.evidence.quote);
  }
});

test("distinct experience conditions are not deduplicated",async()=>{
  const doc=preprocess("3 years with Java\n\n5 years with Java");
  const items=["3 years with Java","5 years with Java"].map(quote=>({...item("Java"),evidence:{quote}}));
  const merged=await semanticExtract(doc,{items:[]},async()=>({items}));
  assert.equal(merged.items.length,2);
});

test("Reap experience stays preferred; Nortal open-ended cloud choice stays grouped",()=>{
  const result=mapToJob({metadata,items:[
    item("Experience in financial domains","preferred"),
    item("Experience working in high-growth teams","preferred"),
    {type:"alternative",operator:"anyOf",values:["AWS","other cloud services"],kind:"requirement",classification:"preferred",evidence:{quote:"Proficiency with AWS or other cloud services"}},
  ]});
  assert.equal(result.valid,true);
  assert.equal(result.job.requirements.preferred.length,2);
  assert.equal(result.job.requirements.competencies.length,0);
  assert.deepEqual(result.job.alternativeRequirements[0].values,["AWS","other cloud services"]);
});

test("merged coverage references include deterministic items and remap duplicates", async()=>{
  const doc=preprocess("Requirements\n- Node.js\n- AI fluency");
  const [first,second]=doc.sections[0].units;
  const response={items:[item("AI fluency"),item("AI fluency")],coverage:[
    {unitId:first.id,status:"excluded",reason:"Already extracted deterministically"},
    {unitId:second.id,status:"extracted",itemIndices:[0,1]},
  ]};
  const merged=await semanticExtract(doc,{items:[item("Node.js")]},async()=>response);
  assert.equal(merged.items.length,2);
  assert.equal(validateCoverage(doc,merged).valid,true);
  assert.deepEqual(merged.coverage[0].itemIndices,[0]);
  assert.deepEqual(merged.coverage[1].itemIndices,[1]);
});

test("source references derive indexes locally regardless of item order, with metadata-only units", async () => {
  const { deriveCoverage } = await import("../lib/job-parser/coverage.mjs");
  const doc=preprocess("Company: Example\n\nRequirements\n- Database knowledge\n- AI fluency");
  const [company,database,ai]=doc.sections.flatMap(s=>s.units);
  const response={metadata:{company:{value:"Example",evidence:{quote:"Company: Example"},sourceUnitIds:[company.id]}},items:[
    {...item("AI fluency"),sourceUnitIds:[ai.id]},
    {...item("Database knowledge"),sourceUnitIds:[database.id]},
  ],coverage:[]};
  const before=structuredClone(response);
  const first=deriveCoverage(doc,response);
  assert.equal(first.valid,true,JSON.stringify(first.errors));
  assert.deepEqual(first.extraction.coverage[0],{unitId:company.id,status:"metadata",metadataKeys:["company"]});
  assert.deepEqual(first.extraction.coverage[1].itemIndices,[1]);
  const reversed=deriveCoverage(doc,{...response,items:[...response.items].reverse()});
  assert.equal(reversed.valid,true);
  assert.deepEqual(reversed.extraction.coverage[1].itemIndices,[0]);
  assert.deepEqual(response,before);
  const merged=await semanticExtract(doc,{items:[]},async()=>first.extraction);
  assert.equal(merged.items.length,2);
  assert.equal(merged.metadata.company.value,"Example");
});

test("new source-reference contract rejects old index bookkeeping and contradictory references", async () => {
  const { deriveCoverage } = await import("../lib/job-parser/coverage.mjs");
  const doc=preprocess("Requirements\n- Database knowledge\n- AI fluency");
  const [db,ai]=doc.sections[0].units;
  const response={items:[{...item("Database knowledge"),sourceUnitIds:[db.id]}],coverage:[{unitId:ai.id,status:"excluded",reason:"Test exclusion"}]};
  for(const [change,code] of [
    [x=>x.coverage=[{unitId:db.id,status:"extracted",itemIndices:[22]}],"model_generated_indexes"], // Reap nonexistent index
    [x=>x.items[0].sourceUnitIds=[ai.id],"unrelated_source_reference"], // Pride wrong linkage
    [x=>x.items[0].sourceUnitIds=["unit-invented"],"unknown_unit"],
    [x=>delete x.items[0].sourceUnitIds,"missing_source_reference"],
    [x=>x.coverage.push({unitId:db.id,status:"excluded",reason:"Metadata only"}),"conflicting_decision"],
    [x=>x.coverage=[],"unaccounted_unit"], // Nortal missing tail units
    [x=>x.coverage[0].status="unresolved","unresolved_unit"],
  ]){
    const copy=structuredClone(response);change(copy);
    const result=deriveCoverage(doc,copy);
    assert.equal(result.valid,false);
    assert.ok(result.errors.some(e=>e.code===code),JSON.stringify(result.errors));
  }
});
