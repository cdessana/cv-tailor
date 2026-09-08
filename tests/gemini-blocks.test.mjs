import assert from "node:assert/strict";
import test from "node:test";
import Ajv from "ajv";
import { createBlockContract } from "../lib/job-parser/providers/gemini-blocks.mjs";
import { preprocessJobDescription as preprocess } from "../lib/job-parser/preprocess.mjs";
import { validateEvidence } from "../lib/job-parser/validate-evidence.mjs";
import { semanticExtract } from "../lib/job-parser/semantic-extract.mjs";

const empty=()=>({items:[],alternatives:[],metadata:{},reason:""});
const ordinary=(value)=>({type:"item",value,kind:"requirement",classification:"required",evidence:{quote:value}});
const doc=preprocess("Company: Example\nPosition: Engineer\n\nIntroduction\n\nRequirements\n- Java or Kotlin\n- AI fluency\n\nBenefits:\n- Paid leave");
const contract=createBlockContract(doc);
const [meta,intro,choice,ai,benefit]=contract.blocks;
const alternative={type:"alternative",operator:"anyOf",values:["Java","Kotlin"],kind:"skill",classification:"required",evidence:{quote:"Java or Kotlin"}};
const valid={blocks:{
 [meta.id]:{...empty(),status:"extracted",items:[],metadata:{company:{value:"Example",evidence:{quote:"Company: Example"}},title:{value:"Engineer",evidence:{quote:"Position: Engineer"}}}},
 [intro.id]:{...empty(),status:"excluded",reason:"Introduction only"},
 [choice.id]:{...empty(),status:"extracted",alternatives:[alternative]},
 [ai.id]:{...empty(),status:"extracted",items:[ordinary("AI fluency")]},
 [benefit.id]:{...empty(),status:"excluded",reason:"Paid leave is a benefit"},
}};

test("blocks colocate IDs/text and preserve document order and heading context",()=>{
 assert.equal(meta.text,"Company: Example\nPosition: Engineer");
 assert.equal(choice.heading,"Requirements");
 assert.equal(choice.signal,"required");
 assert.deepEqual(contract.schema.properties.blocks.required,contract.blocks.map(b=>b.id));
});

test("metadata-only and extracted blocks assemble without model references or indexes",async()=>{
 const before=structuredClone(valid);
 const extraction=contract.assemble(valid);
 assert.equal(extraction.metadata.title.value,"Engineer");
 assert.deepEqual(extraction.metadata.title.sourceUnitIds,[meta.id]);
 assert.deepEqual(extraction.items[0].sourceUnitIds,[choice.id]);
 assert.deepEqual(extraction.coverage[0],{unitId:meta.id,status:"metadata",metadataKeys:["company","title"]});
 assert.equal(validateEvidence(doc,extraction).valid,true);
 const merged=await semanticExtract(doc,{items:[]},async()=>extraction);
 assert.equal(merged.items.length,2);
 assert.deepEqual(valid,before);
 const reversed={blocks:Object.fromEntries(Object.entries(valid.blocks).reverse())};
 assert.deepEqual(contract.assemble(reversed),extraction);
});

for(const [name,modify] of [
 ["missing Nortal tail block",x=>delete x.blocks[benefit.id]],
 ["unknown block",x=>x.blocks.invented={...empty(),status:"excluded",reason:"unknown"}],
 ["legacy Reap item-index bookkeeping",x=>x.blocks[ai.id].itemIndices=[22]],
 ["model source IDs",x=>x.blocks[ai.id].items[0].sourceUnitIds=[meta.id]],
 ["missing value",x=>delete x.blocks[ai.id].items[0].value],
 ["missing operator",x=>delete x.blocks[choice.id].alternatives[0].operator],
 ["invalid type",x=>x.blocks[ai.id].items[0].value=4],
 ["unexpected evidence field",x=>x.blocks[ai.id].items[0].evidence.extra=true],


])test(`actual outgoing schema rejects ${name}`,()=>{
 const copy=structuredClone(valid);modify(copy);
 const validate=new Ajv({strict:true}).compile(contract.schema);
 assert.equal(validate(copy),false);
 assert.throws(()=>contract.assemble(copy),/Invalid block response/);
});

for(const [name,modify,pattern] of [
 ["wrong kind/classification",x=>x.blocks[ai.id].items[0].kind="responsibility",/Invalid intermediate/],
 ["excluded block with items",x=>x.blocks[benefit.id].items=[ordinary("Paid leave")],/must not contain records/],
 ["title assigned to introduction",x=>{x.blocks[intro.id]={...empty(),status:"extracted",items:[],metadata:x.blocks[meta.id].metadata};x.blocks[meta.id]={...empty(),status:"excluded",reason:"moved"};},/Evidence must occur/],
 ["empty extracted result",x=>x.blocks[ai.id].items=[],/no items or metadata/],
 ["blank exclusion",x=>x.blocks[benefit.id].reason=" ",/Invalid intermediate/],
 ["unresolved unit",x=>x.blocks[benefit.id].status="unresolved",/unresolved_unit/],
])test(`assembly rejects ${name}`,()=>{
 const copy=structuredClone(valid);modify(copy);assert.throws(()=>contract.assemble(copy),pattern);
});

test("correctly placed but paraphrased Reap values still fail evidence validation",()=>{
 const source=preprocess("Requirements\n- Data modeling and access: relational databases like Postgres and MySQL");
 const c=createBlockContract(source),id=c.blocks[0].id;
 const bad=ordinary("Data modeling and access (Postgres, MySQL)");
 bad.evidence.quote="Data modeling and access: relational databases like Postgres and MySQL";
 const extraction=c.assemble({blocks:{[id]:{...empty(),status:"extracted",items:[bad]}}});
 assert.equal(validateEvidence(source,extraction).valid,false);
});

test("empty source permits only empty block results",()=>{
 const c=createBlockContract(preprocess(""));
 assert.deepEqual(c.assemble({blocks:{}}),{items:[],coverage:[]});
});

test("record branches accept supported kinds and reject incompatible classifications",()=>{
 const validate=new Ajv({strict:true}).compile(contract.schema);
 for(const kind of ["skill","requirement","competency","responsibility","ambiguous"]){
  const classification=kind==="responsibility"?"not-applicable":kind==="ambiguous"?"ambiguous":"preferred";
  const copy=structuredClone(valid);
  copy.blocks[choice.id].alternatives=[{...alternative,kind,classification}];
  copy.blocks[ai.id].items=[{...ordinary("AI fluency"),kind,classification}];
  assert.equal(validate(copy),true);
 }
});

test("duplicate metadata is accounted for without guessing or overwriting conflicts",()=>{
 const source=preprocess("Company: Example\n\nExample is hiring");
 const c=createBlockContract(source),[first,second]=c.blocks;
 const block=quote=>({...empty(),status:"extracted",items:[],metadata:{company:{value:"Example",evidence:{quote}}}});
 const payload={blocks:{[first.id]:block("Company: Example"),[second.id]:block("Example is hiring")}};
 const assembled=c.assemble(payload);
 assert.equal(assembled.metadata.company.value,"Example");
 assert.equal(assembled.coverage.length,2);
 assert.equal(assembled.coverage.filter(x=>x.status==="excluded").length,1);
 payload.blocks[second.id].metadata.company.value="hiring";
 const result = c.assemble(payload);
 assert.equal(result.metadata.company.candidates.length, 2);
 assert.equal(result.metadata.company.candidates.some(c => c.value === "hiring"), true);
});
