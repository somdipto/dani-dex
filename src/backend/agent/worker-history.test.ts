// @vitest-environment node
import {describe,it,expect} from "vitest";
import {transferableHistory,historyData,type WorkerHistoryEntry} from "./worker-history";
const coverage:WorkerHistoryEntry={kind:"coverage",turnId:"origin",version:1,fromBeginning:true};
const user:WorkerHistoryEntry={kind:"user",turnId:"a",input:[{type:"text",text:"original"}]};
const terminal:WorkerHistoryEntry={kind:"terminal",turnId:"a",status:"interrupted"};
const tool=(status:string,effectUnknown:boolean):WorkerHistoryEntry=>({kind:"item",turnId:"a",item:{id:"call",type:"toolCall",status,result:{value:931}},operation:"read",effectCommitted:status==="completed",effectUnknown});
describe("committed history transfer",()=>{
 it("fails closed for migrated/incomplete history and crash before outcome",()=>{
  expect(()=>transferableHistory([user,terminal],"new")).toThrow("coverage");
  expect(()=>transferableHistory([coverage,user],"new")).toThrow("terminal");
  expect(()=>transferableHistory([coverage,user,tool("in_progress",true),terminal],"new")).toThrow("unknown");
 });
 it("preserves successful effects from interrupted turns, folds failed to completed, and excludes current input",()=>{
  const done=tool("completed",false);
  const entries=[coverage,user,tool("failed",true),done,terminal,{...user,turnId:"new"}];
  const transfer=transferableHistory(entries,"new");
  expect(transfer).toEqual([coverage,user,done,terminal]);
  expect(JSON.stringify(transfer)).not.toContain('"turnId":"new"');
  expect(historyData(transfer).type).toBe("text");
 });
 it("preserves denied operations without granting replay or a committed effect",()=>{
  const denied={...tool("failed",false),permission:"denied" as const};
  expect(transferableHistory([coverage,user,denied,terminal],"new")).toContainEqual(denied);
 });
 it("rejects conflicting tool operations with the same call ID",()=>{
  expect(()=>transferableHistory([coverage,user,tool("completed",false),{...tool("completed",false),operation:"write"},terminal],"new")).toThrow("Conflicting");
 });
 it("rejects contradictory terminal status, tool kind and completed results",()=>{
  const done=tool("completed",false);
  expect(()=>transferableHistory([coverage,user,terminal,{...terminal,status:"completed"}],"new")).toThrow("terminal");
  expect(()=>transferableHistory([coverage,user,{...done,toolKind:"read"},{...done,toolKind:"edit"},terminal],"new")).toThrow("kind");
  expect(()=>transferableHistory([coverage,user,done,{...done,item:{...done.item,result:{value:932}}},terminal],"new")).toThrow("results");
 });
 it("preserves ordered steer input exactly once beside the original input",()=>{
  const steer:WorkerHistoryEntry={kind:"steer",turnId:"a",input:[{type:"text",text:"changed fact"}]};
  expect(transferableHistory([coverage,user,steer,terminal],"new")).toEqual([coverage,user,steer,terminal]);
 });
 it("does not silently truncate long history",()=>{
  expect(()=>transferableHistory([coverage,{...user,input:[{type:"text",text:"x".repeat(200001)}]},terminal],"new")).toThrow("budget");
 });
});
