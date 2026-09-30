// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { decodeRecordResponse } from "../protocol";
import { startService } from "../agent-service-test-harness";

it.skipIf(process.env.DANI_KILO_E2E !== "1")("routes synthetic profile generation through actual service gateway", async () => {
 const root=await mkdtemp(join(tmpdir(),"dani-kilo-service-"));
 const started=await startService(root,{provider:"codex",profileGenerationRoute:()=>({provider:"opencode",modelId:"stepfun/step-3.7-flash:free",endpoint:"https://api.kilo.ai/api/gateway/chat/completions"})});
 try{
 const draft=await started.service.generateProfile({prompt:"Synthetic test. Fictional helper Sample Robot. No real people, accounts or projects."},[]);
 expect(draft.name.length).toBeGreaterThan(0);expect(draft.sectionId).toBeNull();
 console.log("SERVICE_PROFILE_SCHEMA_VALID",JSON.stringify(draft));
 await started.store.getOrCreate("agent-a", "Sample Writer", "Write fictional sample agendas");
 await started.store.getOrCreate("agent-b", "Sample Reviewer", "Review fictional sample agendas");
 await started.service.channels.command({type:"save",channelId:"synthetic-team",operationId:"save-synthetic",draft:{name:"Synthetic team",title:"Fictional coordination",instructions:"Synthetic test only, no real people, accounts or projects.",members:[{agentId:"agent-a"},{agentId:"agent-b"}],leadAgentId:"agent-a"}}, {id:"synthetic-human",name:"Synthetic"});
 await started.service.channels.command({type:"send",channelId:"synthetic-team",operationId:"send-synthetic",text:"Prepare a fictional three-item sample meeting agenda. Select one member.",recipientAgentId:null,replyToMessageId:null,attachmentDraftIds:[]}, {id:"synthetic-human",name:"Synthetic"});
 await vi.waitFor(()=>expect(started.service.channels.store.assignments("synthetic-team").some(item=>item.deliveryId)).toBe(true),{timeout:30000});
 console.log("TEAM_ROUTING_DECODED",JSON.stringify(started.service.channels.store.tasks("synthetic-team")));

 }finally{await started.service.stop();started.store.database.close();await rm(root,{recursive:true,force:true});}
});

it("bounds mixed profile/team concurrency and cancels on shutdown",async()=>{
 const root=await mkdtemp(join(tmpdir(),"dani-gateway-concurrency-"));
 const started=await startService(root,{provider:"codex",profileGenerationRoute:()=>({provider:"opencode",modelId:"stepfun/step-3.7-flash:free",endpoint:"https://api.kilo.ai/api/gateway/chat/completions"})});
 const requests:AbortSignal[]=[];
 const request=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{
  if(String(url).endsWith("/models"))return new Response(JSON.stringify({data:[{id:"stepfun/step-3.7-flash:free",isFree:true,pricing:{prompt:"0",completion:"0"},architecture:{output_modalities:["text"]}}]}));
  return new Promise<Response>((_resolve,reject)=>{requests.push(init!.signal!);init!.signal!.addEventListener("abort",()=>reject(new Error("aborted")));});
 });vi.stubGlobal("fetch",request);
 try{
  const profiles=[1,2,3].map(()=>started.service.generateProfile({prompt:"Synthetic"},[]).catch(error=>String(error)));
  await vi.waitFor(()=>expect(requests).toHaveLength(3));
  await started.store.getOrCreate("agent-a");await started.store.getOrCreate("agent-b");
  await started.service.channels.command({type:"save",channelId:"synthetic-mixed",operationId:"mixed-save",draft:{name:"Mixed",title:"Synthetic",instructions:"Test",members:[{agentId:"agent-a"},{agentId:"agent-b"}],leadAgentId:"agent-a"}},{id:"synthetic",name:"Synthetic"});
  await started.service.channels.command({type:"send",channelId:"synthetic-mixed",operationId:"mixed-send",text:"Synthetic test",recipientAgentId:null,replyToMessageId:null,attachmentDraftIds:[]},{id:"synthetic",name:"Synthetic"});
  await vi.waitFor(()=>expect(started.service.channels.store.tasks("synthetic-mixed")[0]?.error).toBe("Profile generation is busy. Try again shortly."));
  expect(requests).toHaveLength(3);
  await started.service.stop();expect(requests.every(signal=>signal.aborted)).toBe(true);
  expect((await Promise.all(profiles)).every(result=>String(result).includes("aborted"))).toBe(true);
 }finally{vi.unstubAllGlobals();await started.service.stop();started.store.database.close();await rm(root,{recursive:true,force:true});}
});

import { AcpAgentClient } from "../acp-client";
import { openCodeConfigEnv } from "../opencode-config";
import { validateGatewayRoute } from "./profile-generation";

it.skipIf(process.env.DANI_KILO_WORKER_E2E !== "1")("persists an actual Kilo ACP worker final through AgentService and restart", async () => {
 const root=await mkdtemp(join(tmpdir(),"dani-kilo-durable-"));
 const model="dani-kilo-worker/stepfun/step-3.7-flash:free";
 const endpoint={id:"dani-kilo-worker",name:"Dani",baseUrl:"https://api.kilo.ai/api/gateway",apiKey:null,models:[{id:"stepfun/step-3.7-flash:free",name:"Dani"}],headers:[]};
 const options={profileGenerationRoute:()=>({provider:"opencode" as const,modelId:"stepfun/step-3.7-flash:free",endpoint:"https://api.kilo.ai/api/gateway/chat/completions"}),preferredProvider:"opencode" as const,preferredModel:model,requestTimeoutMs:20000,
 credentials:{apiKey:()=>null,customProviders:()=>[endpoint],mcpServers:()=>[]},
 clientFactory:()=>{const client=new AcpAgentClient({executable:"/tmp/dani-auth-preview-profile/provider-runtimes/opencode/linux-x64/1.18.30/bin/opencode",version:"1.18.30"},20000,{
 provider:"opencode",argv:["acp"],env:{...openCodeConfigEnv({},()=>[endpoint]),XDG_CONFIG_HOME:join(root,"config"),XDG_DATA_HOME:join(root,"data"),XDG_CACHE_HOME:join(root,"cache")},signInMessage:"Unavailable",hideThoughtChunks:true,
 validateModel:async(id:string)=>{if(id!==model)throw Error("Wrong route");await validateGatewayRoute({endpoint:"https://api.kilo.ai/api/gateway/chat/completions",modelId:"stepfun/step-3.7-flash:free"},AbortSignal.timeout(15000),true)},
 });client.on("diagnostic",line=>console.log("WORKER_DIAGNOSTIC",new Date().toISOString(),line));
 const request=client.request.bind(client);client.request=async(method,...args)=>{console.log("REQUEST_START",new Date().toISOString(),method,JSON.stringify({model:(args[0] as any)?.model,threadId:(args[0] as any)?.threadId,deliveryId:(args[0] as any)?.clientUserMessageId}));const result=await request(method,...args);console.log("REQUEST_DONE",new Date().toISOString(),method);return result;};
 client.on("notification",n=>{if(n.method==="turn/started"||n.method==="turn/completed"||(n.method==="item/completed"&&((n.params as any)?.item?.phase==="final_answer")))console.log("WORKER_EVENT",new Date().toISOString(),JSON.stringify(n));});return client;}};
 process.env.DANI_DEX_OPENCODE_PATH="/tmp/dani-auth-preview-profile/provider-runtimes/opencode/linux-x64/1.18.30/bin/opencode";
 let started=await startService(root,options);
 console.log("WORKER_READY",new Date().toISOString());
 started.service.on("event",event=>{if(event.type==="error")console.log("SERVICE_ERROR",JSON.stringify(event));});
 try{
 const agent=await started.service.createAgent({name:"Sample Robot",description:"Synthetic durable verification",avatarSeed:"setup:sample",avatarHue:215,provider:"opencode",model,initialMessage:"Synthetic no-tools test. Reply exactly DANI DURABLE WORKER OK. Do not use any tool or filesystem action."});
 console.log("CREATED_WORKER",JSON.stringify(agent));
 await vi.waitFor(()=>expect(started.service.listQueue(agent.id).deliveries[0]?.status).toBe("completed"),{timeout:35000});
 const saved=await started.service.readConversation(agent.id);
 console.log("WORKER_LAST_STATE",JSON.stringify(saved));
 expect(saved?.messages.some(m=>m.author==="assistant"&&m.text==="DANI DURABLE WORKER OK"&&m.status==="completed")).toBe(true);
 expect(saved?.messages.find(m=>m.author==="user")?.delivery?.status).toBe("completed");
 console.log("DURABLE_BEFORE_RESTART",JSON.stringify(saved));
 await started.service.stop();
 started=await startService(root,options);
 const restored=await started.service.readConversation(agent.id);
 expect(restored.messages.some(m=>m.author==="assistant"&&m.text==="DANI DURABLE WORKER OK"&&m.status==="completed")).toBe(true);expect(restored.activeTurnId).toBeNull();expect(restored.messages.find(m=>m.author==="user")?.delivery?.status).toBe("completed");
 console.log("DURABLE_AFTER_RESTART",JSON.stringify(restored));
 await started.service.channels.command({type:"save",channelId:"real-synthetic-team",operationId:"save-real",draft:{name:"Sample Team",title:"Synthetic worker verification",instructions:"Synthetic only. Use channel_result to post the final answer. No filesystem, network, or command tools. Complete the assignment.",members:[{agentId:agent.id}],leadAgentId:agent.id}},{id:"synthetic-human",name:"Synthetic"});
 await started.service.channels.command({type:"send",channelId:"real-synthetic-team",operationId:"send-real",text:"Synthetic only. Call channel_result with text exactly equal to this JSON string: \"1. Opening\\n2. Review\\n3. Next steps\". Use the actual channel_result tool, not a plain reply. Then finish.",recipientAgentId:null,replyToMessageId:null,attachmentDraftIds:[]},{id:"synthetic-human",name:"Synthetic"});
 const teamDeadline=Date.now()+45000;
 while(Date.now()<teamDeadline){if(started.service.channels.store.assignments("real-synthetic-team").some(a=>a.state==="completed"))break;await new Promise(r=>setTimeout(r,100));}
 console.log("REAL_TEAM_BEFORE_RESTART",JSON.stringify({tasks:started.service.channels.store.tasks("real-synthetic-team"),assignments:started.service.channels.store.assignments("real-synthetic-team"),messages:started.service.channels.store.messages("real-synthetic-team")}));
 expect(started.service.channels.store.assignments("real-synthetic-team").some(a=>a.state==="completed")).toBe(true);
 expect(started.service.channels.store.assignments("real-synthetic-team")).toHaveLength(1);
 expect(started.service.channels.store.tasks("real-synthetic-team")[0]?.assignmentCount).toBe(1);
 expect(started.service.channels.store.tasks("real-synthetic-team")[0]?.state).toBe("completed");
 expect(started.service.channels.store.messages("real-synthetic-team").filter(m=>m.id.startsWith("channel-result-"))).toHaveLength(1);
 expect(started.service.channels.store.messages("real-synthetic-team").find(m=>m.id.startsWith("channel-result-"))?.message.text).toBe("1. Opening\n2. Review\n3. Next steps");

 expect(started.service.channels.store.messages("real-synthetic-team").some(m=>m.message.author==="assistant")).toBe(true);
 await started.service.stop();started=await startService(root,options);
 expect(started.service.channels.store.assignments("real-synthetic-team").some(a=>a.state==="completed")).toBe(true);
 expect(started.service.channels.store.assignments("real-synthetic-team")).toHaveLength(1);
 expect(started.service.channels.store.tasks("real-synthetic-team")[0]?.assignmentCount).toBe(1);
 expect(started.service.channels.store.tasks("real-synthetic-team")[0]?.state).toBe("completed");
 expect(started.service.channels.store.messages("real-synthetic-team").filter(m=>m.id.startsWith("channel-result-"))).toHaveLength(1);
 expect(started.service.channels.store.messages("real-synthetic-team").find(m=>m.id.startsWith("channel-result-"))?.message.text).toBe("1. Opening\n2. Review\n3. Next steps");

 expect(started.mailbox.unresolvedDeliveries()).toHaveLength(0);
 console.log("REAL_TEAM_AFTER_RESTART",JSON.stringify({tasks:started.service.channels.store.tasks("real-synthetic-team"),assignments:started.service.channels.store.assignments("real-synthetic-team"),messages:started.service.channels.store.messages("real-synthetic-team")}));

 }finally{await started.service.stop();await rm(root,{recursive:true,force:true});}
},90000);

import { ClientSideConnection } from "@agentclientprotocol/sdk";
it.skipIf(process.env.DANI_KILO_FALLBACK_E2E !== "1")("real ACP Kilo fallback after safely injected pre-inference policy refusal persists single completed delivery",async()=>{
 const root=await mkdtemp(join(tmpdir(),"dani-kilo-fallback-"));
 const model="dani-kilo-worker/stepfun/step-3.7-flash:free";
 const endpoint={id:"dani-kilo-worker",name:"Dani",baseUrl:"https://api.kilo.ai/api/gateway",apiKey:null,models:[{id:"stepfun/step-3.7-flash:free",name:"Dani"}],headers:[]};
 const options={preferredProvider:"opencode" as const,preferredModel:"opencode/big-pickle",requestTimeoutMs:20000,credentials:{apiKey:()=>null,customProviders:()=>[endpoint],mcpServers:()=>[]},clientFactory:()=>new AcpAgentClient({executable:"/tmp/dani-auth-preview-profile/provider-runtimes/opencode/linux-x64/1.18.30/bin/opencode",version:"1.18.30"},20000,{
 provider:"opencode",argv:["acp"],env:{...openCodeConfigEnv({},()=>[endpoint]),XDG_CONFIG_HOME:join(root,"config"),XDG_DATA_HOME:join(root,"data"),XDG_CACHE_HOME:join(root,"cache")},signInMessage:"Unavailable",hideThoughtChunks:true,fallbackModel:model,
 validateModel:async(id,signal)=>{if(id===model)await validateGatewayRoute({endpoint:"https://api.kilo.ai/api/gateway/chat/completions",modelId:"stepfun/step-3.7-flash:free"},AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])]),true)},
 })};
 process.env.DANI_DEX_OPENCODE_PATH="/tmp/dani-auth-preview-profile/provider-runtimes/opencode/linux-x64/1.18.30/bin/opencode";
 const original=ClientSideConnection.prototype.prompt;let attempts=0;
 const spy=vi.spyOn(ClientSideConnection.prototype,"prompt").mockImplementation(function(this:ClientSideConnection,params){attempts++;console.log("LIVE_FALLBACK_PROMPT_ATTEMPT",new Date().toISOString(),attempts,params.sessionId);if(attempts===1)return Promise.reject(new Error("OpenCode's free tier can only be used from within OpenCode"));return original.call(this,params);});
 let started=await startService(root,options);
 started.service.on("event",event=>{if(event.type==="error")console.log("FALLBACK_SERVICE_ERROR",JSON.stringify(event));});
 try{
 console.log("FALLBACK_AVAILABLE_MODELS",JSON.stringify(started.service.listModels()));
 const agent=await started.service.createAgent({name:"Fallback Robot",description:"Synthetic only",avatarSeed:"setup:fallback",avatarHue:215,provider:"opencode",model:"opencode/big-pickle",initialMessage:"Synthetic only. Reply exactly DANI LIVE FALLBACK OK. Do not use tools or filesystem actions."});
 await vi.waitFor(()=>expect(started.service.listQueue(agent.id).deliveries[0]?.status).toBe("completed"),{timeout:25000}).catch(async error=>{console.log("FALLBACK_LAST_QUEUE",JSON.stringify(started.service.listQueue(agent.id)));console.log("FALLBACK_LAST_CONVERSATION",JSON.stringify(await started.service.readConversation(agent.id)));throw error;});
 const before=await started.service.readConversation(agent.id);const session=started.store.database.activeProviderSession(before.threadId!,"opencode")!;
 console.log("LIVE_FALLBACK_EXACT_RESPONSE",JSON.stringify(before));
 expect(before.messages.filter(m=>m.author==="assistant"&&m.text==="DANI LIVE FALLBACK OK"&&m.status==="completed")).toHaveLength(1);expect(before.activeTurnId).toBeNull();expect(started.service.listQueue(agent.id).deliveries).toHaveLength(1);expect(session.model).toBe(model);expect(attempts).toBe(2);
 console.log("LIVE_FALLBACK_BEFORE_RESTART",JSON.stringify({conversation:before,session}));await started.service.stop();started=await startService(root,options);
 const after=await started.service.readConversation(agent.id);expect(after.messages.filter(m=>m.author==="assistant"&&m.text==="DANI LIVE FALLBACK OK")).toHaveLength(1);expect(started.service.listQueue(agent.id).deliveries[0]?.status).toBe("completed");expect(attempts).toBe(2);
 expect(started.store.database.activeProviderSession(after.threadId!,"opencode")?.externalSessionId).toBe(session.externalSessionId);
 console.log("LIVE_FALLBACK_AFTER_RESTART",JSON.stringify(after));
 }finally{spy.mockRestore();await started.service.stop();await rm(root,{recursive:true,force:true});}
},60000);

import { readFile, writeFile } from "node:fs/promises";
import { requireProviderDriver } from "../provider-drivers";
it.skipIf(process.env.DANI_KILO_HISTORY_E2E !== "1")("ordered native read history survives restart and reaches fallback without replay",async()=>{
 const root=await mkdtemp(join(tmpdir(),"dani-history-"));
 const worker="dani-kilo-worker/stepfun/step-3.7-flash:free";
 const binary="/tmp/dani-auth-preview-profile/provider-runtimes/opencode/linux-x64/1.18.30/bin/opencode";
 const endpoint={id:"dani-kilo-worker",name:"Dani",baseUrl:"https://api.kilo.ai/api/gateway",apiKey:null,models:[{id:"stepfun/step-3.7-flash:free",name:"Dani"}],headers:[]};
 let primaryFailure=false;let readEffects=0;const attempts:string[]=[];const historyInputs:string[]=[];
 const original=ClientSideConnection.prototype.prompt;
 const spy=vi.spyOn(ClientSideConnection.prototype,"prompt").mockImplementation(function(this:ClientSideConnection,params){
  attempts.push(params.sessionId);if(primaryFailure){primaryFailure=false;return Promise.reject(new Error("OpenCode's free tier can only be used from within OpenCode"));}
  if(params.prompt.some(block=>block.type==="text"&&block.text.includes("<committed_history>")))historyInputs.push(JSON.stringify(params.prompt));
  return original.call(this,params);
 });
 const options={preferredProvider:"opencode" as const,preferredModel:worker,requestTimeoutMs:20000,
 credentials:{apiKey:()=>null,customProviders:()=>[endpoint],mcpServers:()=>[],fallbackModel:worker,
 validateModel:async(id:string,signal?:AbortSignal)=>{if(id===worker)await validateGatewayRoute({endpoint:"https://api.kilo.ai/api/gateway/chat/completions",modelId:"stepfun/step-3.7-flash:free"},AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])]),true)}},
 providerDriver:(provider:any)=>{const driver=requireProviderDriver(provider);if(provider!=="opencode")return driver;return {...driver,createClient:(cli:any,timeout:any,context:any)=>{const client=new AcpAgentClient(cli,timeout,{provider:"opencode",argv:["acp"],env:{...openCodeConfigEnv({permission:{'*':'ask'}},context.customProviders),XDG_CONFIG_HOME:join(root,"config"),XDG_DATA_HOME:join(root,"data"),XDG_CACHE_HOME:join(root,"cache")},signInMessage:"Unavailable",hideThoughtChunks:true,servesModel:context.servesModel,validateModel:context.validateModel,fallbackModel:worker,workerHistory:context.workerHistory});
 client.on("notification",n=>{if(n.method==="item/completed"&&(n.params as any)?.item?.type==="toolCall"){console.log("HISTORY_TOOL_EVENT",JSON.stringify(n));if((n.params as any).item.arguments?.filePath?.endsWith("/sample.txt"))readEffects++;}});return client;}};},
 };
 process.env.DANI_DEX_OPENCODE_PATH=binary;
 let started=await startService(root,options);
 const approvals=(event:any)=>{if(event.type==="approval")void started.service.respondToApproval({requestId:event.approval.requestId,decision:"accept",scope:"once"} as any);};started.service.on("event",approvals);
 try{
 const agent=await started.service.createAgent({name:"History Robot",description:"Synthetic no-private-data test",avatarSeed:"setup:history",avatarHue:215,provider:"opencode",model:worker,initialMessage:"The fictional codeword is BLUEBIRD-742. Reply exactly FACT SAVED. No tools; do not call remember."});
 await vi.waitFor(()=>expect(started.service.listQueue(agent.id).deliveries[0]?.status).toBe("completed"),{timeout:30000});
 await writeFile(join(agent.workspacePath,"sample.txt"),"SYNTHETIC READ VALUE 931");
 await started.service.sendMessage({agentId:agent.id,text:`Read ${join(agent.workspacePath,"sample.txt")} with the native read tool exactly once. Do not write/change anything or use other tools. Reply exactly READ SAVED after reading.`,attachmentDraftIds:[]});
 await vi.waitFor(()=>expect(started.service.listQueue(agent.id).deliveries.filter(d=>d.status==="completed")).toHaveLength(2),{timeout:30000});
 const before=await started.service.readConversation(agent.id);
 const rows=started.store.database.connection.prepare("SELECT payload_json FROM orchestration_events WHERE aggregate_id=? AND event_type='turn.worker-history' ORDER BY sequence").all(before.threadId!);
 const committed=rows.map(row=>JSON.parse(String(row.payload_json)).entry);
 console.log("ORDERED_COMMITTED_HISTORY",JSON.stringify(committed));

 expect(committed.filter(e=>e.kind==="user")).toHaveLength(2);expect(committed.filter(e=>e.kind==="terminal")).toHaveLength(2);expect(committed.some(e=>e.kind==="item"&&e.effectCommitted&&e.item.type==="toolCall")).toBe(true);
 expect(JSON.stringify(committed)).toContain("SYNTHETIC READ VALUE 931");
 await started.service.stop();started=await startService(root,options);started.service.on("event",approvals);
 await started.service.updateAgent({agentId:agent.id,provider:"opencode",model:"opencode/big-pickle"});
 primaryFailure=true;
 await started.service.sendMessage({agentId:agent.id,text:"Using only the prior conversation and prior read result, return the fictional codeword and the read value. No tool calls, do not reread or write files.",attachmentDraftIds:[]});
 await vi.waitFor(()=>expect(started.service.listQueue(agent.id).deliveries.filter(d=>d.status==="completed")).toHaveLength(3),{timeout:30000});
 const after=await started.service.readConversation(agent.id);const final=after.messages.filter(m=>m.author==="assistant").at(-1)!;
 expect(final.text).toContain("BLUEBIRD-742");expect(final.text).toContain("931");expect(readEffects).toBe(1);expect(historyInputs).toHaveLength(1);
 expect(historyInputs[0].indexOf("BLUEBIRD-742")).toBeLessThan(historyInputs[0].indexOf("sample.txt"));
 expect(await readFile(join(agent.workspacePath,"sample.txt"),"utf8")).toBe("SYNTHETIC READ VALUE 931");
 console.log("HISTORY_FALLBACK_FINAL",JSON.stringify({final,readEffects,attempts,historyTransfers:historyInputs.length}));
 }finally{spy.mockRestore();await started.service.stop();await rm(root,{recursive:true,force:true});}
},100000);

it.skipIf(process.env.DANI_KILO_CANCEL_E2E!=="1")("real ACP Kilo cancel leaves interrupted delivery and no late final",async()=>{
 const root=await mkdtemp(join(tmpdir(),"dani-live-cancel-"));
 const model="dani-kilo-worker/stepfun/step-3.7-flash:free";
 const endpoint={id:"dani-kilo-worker",name:"Dani",baseUrl:"https://api.kilo.ai/api/gateway",apiKey:null,models:[{id:"stepfun/step-3.7-flash:free",name:"Dani"}],headers:[]};
 const binary="/tmp/dani-auth-preview-profile/provider-runtimes/opencode/linux-x64/1.18.30/bin/opencode";
 let sent=false;let client:AcpAgentClient;const events:any[]=[];const entries:any[]=[];
 const original=ClientSideConnection.prototype.prompt;
 const spy=vi.spyOn(ClientSideConnection.prototype,"prompt").mockImplementation(function(this:ClientSideConnection,params){
   sent=true;const response=original.call(this,params);
   setTimeout(()=>void client.request("turn/interrupt",{threadId:params.sessionId},decodeRecordResponse),100);return response;
 });
 const options={preferredProvider:"opencode" as const,preferredModel:model,requestTimeoutMs:20000,credentials:{apiKey:()=>null,customProviders:()=>[endpoint],mcpServers:()=>[]},
 clientFactory:()=>{
  client=new AcpAgentClient({executable:binary,version:"1.18.30"},20000,{provider:"opencode",argv:["acp"],env:{...openCodeConfigEnv({},()=>[endpoint]),XDG_CONFIG_HOME:join(root,"config"),XDG_DATA_HOME:join(root,"data"),XDG_CACHE_HOME:join(root,"cache")},signInMessage:"none",hideThoughtChunks:true,
    workerHistory:{read:()=>entries,append:(_id,e)=>entries.push(e)}});
  client.on("notification",n=>events.push(n));return client;
 }};
 process.env.DANI_DEX_OPENCODE_PATH=binary;const started=await startService(root,options);
 try{
  const agent=await started.service.createAgent({name:"Cancel Robot",description:"Synthetic live cancellation",avatarSeed:"setup:cancel",avatarHue:215,provider:"opencode",model,initialMessage:"Synthetic cancellation test. No tools or filesystem actions. Count from 1 to 100 in words."});
  await vi.waitFor(()=>expect(started.service.listQueue(agent.id).deliveries[0]?.status).toBe("interrupted"),{timeout:30000});
  await new Promise(resolve=>setTimeout(resolve,1500));
  const snapshot=await started.service.readConversation(agent.id);
  expect(sent).toBe(true);expect(events.filter(e=>e.method==="turn/completed")).toHaveLength(1);expect(snapshot.activeTurnId).toBeNull();
  expect(events.some(e=>e.method==="item/completed"&&e.params?.item?.phase==="final_answer")).toBe(false);
  console.log("LIVE_CANCEL_PROOF",JSON.stringify({sent,delivery:started.service.listQueue(agent.id).deliveries[0],entries,events:events.filter(e=>e.method==="turn/completed"),snapshot}));
 }finally{spy.mockRestore();await started.service.stop();await rm(root,{recursive:true,force:true});}
},45000);

it.skipIf(process.env.DANI_KILO_REVOKE_E2E!=="1")("real Kilo catalog revocation before dispatch sends no prompt",async()=>{
 const root=await mkdtemp(join(tmpdir(),"dani-live-cancel-"));
 const model="dani-kilo-worker/stepfun/step-3.7-flash:free";
 const endpoint={id:"dani-kilo-worker",name:"Dani",baseUrl:"https://api.kilo.ai/api/gateway",apiKey:null,models:[{id:"stepfun/step-3.7-flash:free",name:"Dani"}],headers:[]};
 const binary="/tmp/dani-auth-preview-profile/provider-runtimes/opencode/linux-x64/1.18.30/bin/opencode";
 let sent=false;let client:AcpAgentClient;const events:any[]=[];const entries:any[]=[];
 const original=ClientSideConnection.prototype.prompt;
 const spy=vi.spyOn(ClientSideConnection.prototype,"prompt").mockImplementation(function(this:ClientSideConnection,params){
   sent=true;const response=original.call(this,params);
   return response;
 });
 const options={preferredProvider:"opencode" as const,preferredModel:model,requestTimeoutMs:20000,credentials:{apiKey:()=>null,customProviders:()=>[endpoint],mcpServers:()=>[]},
 clientFactory:()=>{
  client=new AcpAgentClient({executable:binary,version:"1.18.30"},20000,{provider:"opencode",argv:["acp"],env:{...openCodeConfigEnv({},()=>[endpoint]),XDG_CONFIG_HOME:join(root,"config"),XDG_DATA_HOME:join(root,"data"),XDG_CACHE_HOME:join(root,"cache")},signInMessage:"none",hideThoughtChunks:true,
    workerHistory:{read:()=>entries,append:(_id,e)=>entries.push(e)},validateModel:async()=>{console.log("REVOKE_VALIDATE_BEGIN");const response=await fetch("https://api.kilo.ai/api/gateway/models",{signal:AbortSignal.timeout(10000)});console.log("REVOKE_VALIDATE_CATALOG",response.status);if(!response.ok)throw new Error("Catalog unavailable");throw new Error("Synthetic revocation after live catalog read");}});
  client.on("notification",n=>events.push(n));return client;
 }};
 process.env.DANI_DEX_OPENCODE_PATH=binary;const started=await startService(root,options);
 try{
  const agent=await started.service.createAgent({name:"Cancel Robot",description:"Synthetic live cancellation",avatarSeed:"setup:cancel",avatarHue:215,provider:"opencode",model,initialMessage:"Synthetic cancellation test. No tools or filesystem actions. Count from 1 to 100 in words."});
  await vi.waitFor(()=>expect(started.service.listQueue(agent.id).deliveries[0]?.status).toBe("failed"),{timeout:30000});
  await new Promise(resolve=>setTimeout(resolve,1500));
  const snapshot=await started.service.readConversation(agent.id);
  expect(sent).toBe(false);expect(snapshot.activeTurnId).toBeNull();
  expect(events.some(e=>e.method==="item/completed"&&e.params?.item?.phase==="final_answer")).toBe(false);
  console.log("LIVE_REVOKE_PROOF",JSON.stringify({sent,delivery:started.service.listQueue(agent.id).deliveries[0],entries,events:events.filter(e=>e.method==="turn/completed"),snapshot}));
 }finally{spy.mockRestore();await started.service.stop();await rm(root,{recursive:true,force:true});}
},45000);
