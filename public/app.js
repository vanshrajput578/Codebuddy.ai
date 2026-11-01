const messages=document.getElementById('messages');
const promptInput=document.getElementById('prompt');
const chatForm=document.getElementById('chatForm');
const chatView=document.getElementById('chatView');
const infoView=document.getElementById('infoView');
const pageName=document.getElementById('pageName');
const composerStatus=document.querySelector('.composer-footer span');
const sendButton=chatForm.querySelector('.send-button');
const authPanel=document.getElementById('authPanel');
const authForm=document.getElementById('authForm');
const authError=document.getElementById('authError');
const authSwitch=document.getElementById('authSwitch');
const authTitle=document.getElementById('authTitle');
const authDescription=document.getElementById('authDescription');
const authSubmit=document.getElementById('authSubmit');
const nameField=document.getElementById('nameField');
const accountBar=document.getElementById('accountBar');
const accountLabel=document.getElementById('accountLabel');
const suggestions=document.getElementById('suggestions');
const chatArea=document.getElementById('chatArea');
const providerSettings=document.getElementById('providerSettings');
const tasksView=document.getElementById('tasksView');
const filesView=document.getElementById('filesView');
const agentTaskForm=document.getElementById('agentTaskForm');
const agentTaskError=document.getElementById('agentTaskError');
const agentTaskList=document.getElementById('agentTaskList');
const agentTaskDetail=document.getElementById('agentTaskDetail');
let selectedAgentTaskId=null;
const providerSelect=document.getElementById('providerSelect');
const providerModel=document.getElementById('providerModel');
const providerKey=document.getElementById('providerKey');
const providerError=document.getElementById('providerError');
const providerSuccess=document.getElementById('providerSuccess');
const providerList=document.getElementById('providerList');
const providerDefaults={gemini:'gemini-2.5-flash',openrouter:'openai/gpt-4.1-mini',openai:'gpt-4.1-mini',anthropic:'claude-3-5-haiku-latest'};
let sending=false;
let registering=false;
let csrfToken=null;
let currentUser=null;
let conversationId=null;

function addMessage(text,kind){
  const node=document.createElement('div');
  node.className='message '+kind;
  node.textContent=text;
  messages.appendChild(node);
  node.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function setAuthenticated(user,token){
  currentUser=user;
  csrfToken=token;
  authPanel.classList.add('hidden');
  accountBar.classList.remove('hidden');
  suggestions.classList.remove('hidden');
  chatArea.classList.remove('hidden');
  accountLabel.textContent=user.displayName+' · '+user.email;
  composerStatus.textContent='Signed in · Provider key stays on server';
  loadConversations();
}
function setUnauthenticated(){
  currentUser=null;
  csrfToken=null;
  conversationId=null;
  document.getElementById('conversationList').replaceChildren();
  authPanel.classList.remove('hidden');
  accountBar.classList.add('hidden');
  suggestions.classList.add('hidden');
  chatArea.classList.add('hidden');
}
function setAuthMode(createAccount){
  registering=createAccount;
  authTitle.textContent=createAccount?'Create your NEXUS account':'Sign in to NEXUS';
  authDescription.textContent=createAccount?'Use an email and a strong password of at least 12 characters.':'Your conversations are tied to your account.';
  nameField.classList.toggle('hidden',!createAccount);
  document.getElementById('authPassword').setAttribute('autocomplete',createAccount?'new-password':'current-password');
  authSubmit.textContent=createAccount?'Create account':'Sign in';
  authSwitch.textContent=createAccount?'Already registered? Sign in':'New here? Create an account';
  authError.textContent='';
}
async function loadSession(){
  try{
    const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok){setUnauthenticated();return;}
    const data=await response.json();
    if(data.user&&data.csrfToken)setAuthenticated(data.user,data.csrfToken);
    else setUnauthenticated();
  }catch{setUnauthenticated();}
}
authSwitch.addEventListener('click',()=>setAuthMode(!registering));
authForm.addEventListener('submit',async event=>{
  event.preventDefault();
  authError.textContent='';
  authSubmit.disabled=true;
  const payload={
    email:document.getElementById('authEmail').value.trim(),
    password:document.getElementById('authPassword').value
  };
  if(registering)payload.displayName=document.getElementById('authName').value.trim();
  try{
    const response=await fetch(registering?'/api/auth/register':'/api/auth/login',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Authentication failed.');
    setAuthenticated(data.user,data.csrfToken);
    authForm.reset();
  }catch(error){authError.textContent=error.message||'Could not connect to the account service.';}
  finally{authSubmit.disabled=false;}
});
document.getElementById('logoutButton').addEventListener('click',async()=>{
  try{
    await fetch('/api/auth/logout',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken||''},body:'{}'
    });
  }finally{
    messages.replaceChildren();
    setUnauthenticated();
    setAuthMode(false);
  }
});
async function loadConversations(){
  const list=document.getElementById('conversationList');
  if(!currentUser)return;
  try{
    const response=await fetch('/api/conversations',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)return;
    const data=await response.json();
    list.replaceChildren();
    for(const item of (data.conversations||[])){
      const button=document.createElement('button');
      button.type='button';
      button.className='conversation-item'+(item.id===conversationId?' active':'');
      button.textContent=item.title||'New conversation';
      button.title=item.title||'New conversation';
      button.addEventListener('click',()=>loadConversation(item.id));
      list.appendChild(button);
    }
    if(!data.conversations?.length){
      const empty=document.createElement('p');
      empty.className='conversation-empty';
      empty.textContent='No conversations yet';
      list.appendChild(empty);
    }
  }catch{}
}
async function loadConversation(id){
  try{
    const response=await fetch('/api/conversations/'+encodeURIComponent(id)+'/messages',{credentials:'same-origin',cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Could not open conversation.');
    conversationId=id;
    messages.replaceChildren();
    for(const item of (data.messages||[]))addMessage(item.content,item.role==='user'?'user':'system');
    showView('chat');
    loadConversations();
  }catch(error){addMessage(error.message||'Could not open conversation.','system');}
}
async function providerRequest(url,options={}){
  const response=await fetch(url,{
    ...options,credentials:'same-origin',cache:'no-store',
    headers:{...(options.headers||{}),'X-CSRF-Token':csrfToken||''}
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Provider settings request failed.');
  return data;
}
async function loadProviderSettings(){
  if(!currentUser)return;
  try{
    const data=await providerRequest('/api/providers');
    providerList.replaceChildren();
    for(const item of data.providers||[]){
      const row=document.createElement('div');
      row.className='provider-row';
      const label=document.createElement('span');
      label.textContent=item.name+' · '+item.model+' · '+item.keyHint;
      const actions=document.createElement('span');
      actions.className='provider-row-actions';
      const use=document.createElement('button');
      use.type='button';use.textContent=data.activeProvider===item.id?'Active':'Use';
      use.disabled=data.activeProvider===item.id;
      use.addEventListener('click',async()=>{
        try{
          await providerRequest('/api/provider-selection',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:item.id})});
          providerSuccess.textContent=item.name+' is now active.';
          loadProviderSettings();
        }catch(error){providerError.textContent=error.message;}
      });
      actions.append(use);row.append(label,actions);providerList.append(row);
    }
    if(!data.providers?.length){
      const empty=document.createElement('p');empty.className='provider-empty';empty.textContent='No provider keys saved yet.';providerList.append(empty);
    }
  }catch(error){providerError.textContent=error.message;}
}
providerSelect.addEventListener('change',()=>{
  providerModel.value=providerDefaults[providerSelect.value]||'';
  providerKey.value='';
  providerError.textContent='';providerSuccess.textContent='';
});
document.getElementById('providerForm').addEventListener('submit',async event=>{
  event.preventDefault();providerError.textContent='';providerSuccess.textContent='';
  const provider=providerSelect.value;
  const key=providerKey.value;
  const model=providerModel.value.trim();
  if(!key){providerError.textContent='Enter an API key first.';return;}
  document.getElementById('saveProvider').disabled=true;
  try{
    await providerRequest('/api/providers/'+provider,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:key,model})});
    providerKey.value='';
    await providerRequest('/api/provider-selection',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider})});
    providerSuccess.textContent='Key encrypted and saved. It will not be displayed again.';
    loadProviderSettings();
  }catch(error){providerError.textContent=error.message;}
  finally{document.getElementById('saveProvider').disabled=false;providerKey.value='';}
});
document.getElementById('testProvider').addEventListener('click',async()=>{
  providerError.textContent='';providerSuccess.textContent='';
  try{
    const data=await providerRequest('/api/providers/'+providerSelect.value+'/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    providerSuccess.textContent=data.message+' Model: '+data.model;
  }catch(error){providerError.textContent=error.message;}
});
document.getElementById('deleteProvider').addEventListener('click',async()=>{
  providerError.textContent='';providerSuccess.textContent='';
  try{
    await providerRequest('/api/providers/'+providerSelect.value,{method:'DELETE'});
    providerSuccess.textContent='Saved key removed from the vault.';
    loadProviderSettings();
  }catch(error){providerError.textContent=error.message;}
});


const agentFileInput=document.getElementById('agentTaskFiles');
const agentFolderInput=document.getElementById('agentTaskFolder');
const agentFileStatus=document.getElementById('agentFileStatus');
function currentWorkspaceSelection(){
  return [...(agentFileInput?.files||[]),...(agentFolderInput?.files||[])];
}
function formatFileSize(bytes){
  if(bytes<1024)return bytes+' B';
  if(bytes<1024*1024)return (bytes/1024).toFixed(1)+' KiB';
  return (bytes/(1024*1024)).toFixed(2)+' MiB';
}
function updateWorkspaceSelectionStatus(){
  const files=currentWorkspaceSelection();
  const total=files.reduce((sum,file)=>sum+file.size,0);
  if(!files.length){agentFileStatus.textContent='No files selected.';return;}
  agentFileStatus.textContent=files.length+' file(s) selected · '+formatFileSize(total)+' · limit 30 files / 1 MiB';
}
agentFileInput?.addEventListener('change',updateWorkspaceSelectionStatus);
agentFolderInput?.addEventListener('change',updateWorkspaceSelectionStatus);
async function encodeTaskWorkspaceFiles(){
  const files=currentWorkspaceSelection();
  if(files.length>30)throw new Error('Select no more than 30 files.');
  let total=0;
  const output=[];
  for(const file of files){
    if(file.size>256*1024)throw new Error(file.name+' exceeds the 256 KiB per-file limit.');
    total+=file.size;
    if(total>1024*1024)throw new Error('Selected files exceed the 1 MiB total limit.');
    const bytes=new Uint8Array(await file.arrayBuffer());
    let binary='';
    for(let offset=0;offset<bytes.length;offset+=0x8000){
      binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
    }
    output.push({path:file.webkitRelativePath||file.name,contentBase64:btoa(binary)});
  }
  return output;
}
async function downloadWorkspaceFile(taskId,file){
  const response=await providerRequest('/api/agent/tasks/'+taskId+'/files/'+file.id);
  const encoded=response.file.contentBase64;
  const binary=atob(encoded);
  const bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  const blob=new Blob([bytes],{type:'application/octet-stream'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=file.path.split('/').pop()||'workspace-file';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

async function loadFiles(){
  if(!currentUser||!filesView)return;
  const list=document.getElementById('filesList');
  const count=document.getElementById('filesCount');
  list.replaceChildren();
  count.textContent='Loading...';
  try{
    const data=await providerRequest('/api/files');
    const files=Array.isArray(data.files)?data.files:[];
    count.textContent=files.length+' file(s)';
    if(!files.length){
      const empty=document.createElement('div');empty.className='agent-empty';
      const icon=document.createElement('span');icon.textContent='▤';
      const title=document.createElement('b');title.textContent='Your workspace is empty';
      const help=document.createElement('small');help.textContent='Attach files when creating an Agent Task. Terminal outputs will appear here too.';
      const open=makeAgentButton('Open Agent Tasks',()=>showView('tasks'),'auth-submit');
      empty.append(icon,title,help,open);list.append(empty);return;
    }
    for(const file of files){
      const row=document.createElement('article');row.className='files-library-row';
      const details=document.createElement('div');details.className='files-library-details';
      const name=document.createElement('b');name.textContent=file.path;
      const meta=document.createElement('small');meta.textContent=(file.taskTitle||'Agent task')+' · '+formatFileSize(Number(file.sizeBytes)||0);
      details.append(name,meta);
      const actions=document.createElement('div');actions.className='files-library-actions';
      actions.append(
        makeAgentButton('Download',()=>downloadWorkspaceFile(file.taskId,file)),
        makeAgentButton('Open task',async()=>{showView('tasks');await openAgentTask(file.taskId);})
      );
      const remove=makeAgentButton('Remove',async()=>{
        if(!window.confirm('Remove '+file.path+' from this task workspace?'))return;
        try{
          await providerRequest('/api/agent/tasks/'+file.taskId+'/files/'+file.id,{method:'DELETE'});
          await loadFiles();
          if(selectedAgentTaskId===file.taskId)await openAgentTask(file.taskId);
        }catch(error){count.textContent=error.message;}
      },'provider-danger');
      actions.append(remove);row.append(details,actions);list.append(row);
    }
  }catch(error){
    count.textContent='Could not load files';
    const message=document.createElement('p');message.className='auth-error';message.textContent=error.message;list.append(message);
  }
}
function makeAgentButton(label,action,className='provider-secondary'){
  const button=document.createElement('button');
  button.type='button';button.className=className;button.textContent=label;
  button.addEventListener('click',action);return button;
}
async function loadAgentTasks(){
  if(!currentUser)return;
  try{
    const data=await providerRequest('/api/agent/tasks');
    agentTaskList.replaceChildren();
    if(!data.tasks?.length){
      const empty=document.createElement('p');empty.className='provider-empty';empty.textContent='No agent tasks yet.';agentTaskList.append(empty);return;
    }
    for(const task of data.tasks){
      const button=document.createElement('button');
      button.type='button';button.className='agent-task-row'+(task.id===selectedAgentTaskId?' selected':'');
      const title=document.createElement('b');title.textContent=task.title;
      const meta=document.createElement('small');meta.textContent=task.status.replaceAll('_',' ')+' · '+task.current_step+' steps done';
      button.append(title,meta);
      button.addEventListener('click',()=>openAgentTask(task.id));
      agentTaskList.append(button);
    }
  }catch(error){agentTaskError.textContent=error.message;}
}
async function openAgentTask(id){
  selectedAgentTaskId=id;
  try{
    const data=await providerRequest('/api/agent/tasks/'+id);
    const task=data.task;
    agentTaskDetail.replaceChildren();
    const heading=document.createElement('div');heading.className='agent-detail-heading';
    const title=document.createElement('h2');title.textContent=task.title;
    const status=document.createElement('span');status.className='agent-status';status.textContent=task.status.replaceAll('_',' ');
    heading.append(title,status);agentTaskDetail.append(heading);
    const prompt=document.createElement('p');prompt.className='agent-original-prompt';prompt.textContent=task.prompt;agentTaskDetail.append(prompt);
    const workspacePanel=document.createElement('section');workspacePanel.className='agent-files-panel';
    const workspaceHeading=document.createElement('h3');workspaceHeading.textContent='Workspace files';
    workspacePanel.append(workspaceHeading);
    try{
      const workspace=await providerRequest('/api/agent/tasks/'+id+'/files');
      if(workspace.files?.length){
        for(const file of workspace.files){
          const row=document.createElement('div');row.className='agent-file-row';
          const info=document.createElement('span');
          info.textContent=file.path+' · '+formatFileSize(Number(file.sizeBytes)||0);
          row.append(info,makeAgentButton('Download',()=>downloadWorkspaceFile(id,file)));
          workspacePanel.append(row);
        }
      }else{
        const empty=document.createElement('p');empty.className='provider-empty';empty.textContent='No files in this task workspace yet.';workspacePanel.append(empty);
      }
    }catch{
      const unavailable=document.createElement('p');unavailable.className='provider-empty';unavailable.textContent='Workspace file list unavailable.';workspacePanel.append(unavailable);
    }
    agentTaskDetail.append(workspacePanel);
    if(Array.isArray(task.plan?.steps)&&task.plan.steps.length){
      const planTitle=document.createElement('h3');planTitle.textContent='Execution plan · '+task.plan.steps.length+' bounded steps';agentTaskDetail.append(planTitle);
      for(const step of task.plan.steps){
        const card=document.createElement('article');card.className='agent-step';
        const top=document.createElement('div');top.className='agent-step-top';
        const name=document.createElement('b');name.textContent=step.id+'. '+step.title;
        const state=document.createElement('span');state.textContent=step.status||'pending';
        top.append(name,state);
        const desc=document.createElement('p');desc.textContent=step.description;
        const tool=document.createElement('small');tool.textContent='Tool: '+step.tool+(step.requiresApproval?' · Approval required':'');
        card.append(top,desc,tool);
        const input=document.createElement('pre');input.textContent=JSON.stringify(step.input,null,2);card.append(input);
        if(step.result){const result=document.createElement('p');result.className='agent-step-result';result.textContent='Result: '+JSON.stringify(step.result);card.append(result);}
        agentTaskDetail.append(card);
      }
    }
    if(task.result){const result=document.createElement('div');result.className='agent-final-result';result.textContent=task.result;agentTaskDetail.append(result);}
    const actions=document.createElement('div');actions.className='agent-task-actions';
    if(task.status==='awaiting_approval'){
      actions.append(
        makeAgentButton('Approve & execute',()=>agentTaskAction(id,'approve'),'auth-submit'),
        makeAgentButton('Reject plan',()=>agentTaskAction(id,'reject'),'provider-danger')
      );
    }
    if(task.status==='running')actions.append(makeAgentButton('Pause',()=>agentTaskAction(id,'pause')));
    if(task.status==='paused')actions.append(makeAgentButton('Resume',()=>agentTaskAction(id,'resume'),'auth-submit'));
    if(!['completed','failed','cancelled'].includes(task.status))actions.append(makeAgentButton('Cancel task',()=>agentTaskAction(id,'cancel'),'provider-danger'));
    actions.append(makeAgentButton('Refresh details',()=>openAgentTask(id)));
    agentTaskDetail.append(actions);
    if(data.events?.length){
      const eventTitle=document.createElement('h3');eventTitle.textContent='Activity history';agentTaskDetail.append(eventTitle);
      for(const event of data.events){
        const row=document.createElement('p');row.className='agent-event';
        row.textContent=event.event_type.replaceAll('.',' · ')+' — '+new Date(event.created_at).toLocaleString();
        agentTaskDetail.append(row);
      }
    }
    loadAgentTasks();
  }catch(error){agentTaskError.textContent=error.message;}
}
async function agentTaskAction(id,action){
  agentTaskError.textContent='';
  try{
    await providerRequest('/api/agent/tasks/'+id+'/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    await openAgentTask(id);
  }catch(error){agentTaskError.textContent=error.message;await openAgentTask(id);}
}
agentTaskForm.addEventListener('submit',async event=>{
  event.preventDefault();agentTaskError.textContent='';
  const button=document.getElementById('createAgentTask');button.disabled=true;
  try{
    const files=await encodeTaskWorkspaceFiles();
    const created=await providerRequest('/api/agent/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      title:document.getElementById('agentTaskTitle').value.trim(),
      prompt:document.getElementById('agentTaskPrompt').value.trim(),
      files
    })});
    selectedAgentTaskId=created.task.id;
    document.getElementById('agentTaskFiles').value='';
    document.getElementById('agentTaskFolder').value='';
    updateWorkspaceSelectionStatus();
    document.getElementById('agentTaskPrompt').value='';
    await providerRequest('/api/agent/tasks/'+created.task.id+'/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    await openAgentTask(created.task.id);
  }catch(error){agentTaskError.textContent=error.message;}
  finally{button.disabled=false;loadAgentTasks();}
});
document.getElementById('refreshAgentTasks').addEventListener('click',loadAgentTasks);

async function sendMessage(text){
  const value=String(text||'').trim();
  if(!value||sending)return;
  addMessage(value,'user');
  sending=true;
  sendButton.disabled=true;
  composerStatus.textContent='Connecting securely to NEXUS API…';
  try{
    const response=await fetch('/api/chat',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken||''},
      credentials:'same-origin',cache:'no-store',
      body:JSON.stringify({message:value,...(conversationId?{conversationId}:{})})
    });
    const data=await response.json().catch(()=>({}));
    if(response.status===401){setUnauthenticated();throw new Error('Your session expired. Sign in again.');}
    if(!response.ok)throw new Error(data.error||'Request failed. Check the API server.');
    if(typeof data.answer!=='string')throw new Error('The server returned an invalid response.');
    addMessage(data.answer,'system');
    conversationId=data.conversationId||conversationId;
    loadConversations();
    composerStatus.textContent='Connected · Saved to your account';
  }catch(error){
    addMessage(error.message||'Unable to reach the NEXUS API. Confirm that the backend is running.','system');
    composerStatus.textContent='Request failed · Check server';
  }finally{
    sending=false;
    sendButton.disabled=false;
    promptInput.focus();
  }
}
chatForm.addEventListener('submit',event=>{
  event.preventDefault();
  const value=promptInput.value;
  promptInput.value='';
  sendMessage(value);
});
document.querySelectorAll('.suggestion').forEach(button=>button.addEventListener('click',()=>{
  promptInput.value=button.dataset.prompt||'';
  promptInput.focus();
}));
document.getElementById('newChat').addEventListener('click',()=>{
  messages.replaceChildren();
  conversationId=null;
  promptInput.value='';
  loadConversations();
  showView('chat');
});
function showView(view){
  const labels={chat:'AI Workspace',agents:'Agents',tasks:'Tasks',files:'Files',memory:'Memory',settings:'AI Providers'};
  const descriptions={
    agents:'Create specialized agents, configure their tools and review permissions.',
    tasks:'Monitor queued, running, paused and completed agent tasks.',
    files:'Manage files generated or uploaded to your secure workspace.',
    memory:'Review, edit, export and delete information saved to your account.'
  };
  document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view===view));
  pageName.textContent=labels[view]||labels.chat;
  chatView.classList.toggle('hidden',view!=='chat');
  infoView.classList.toggle('hidden',view==='chat'||view==='settings'||view==='tasks'||view==='files');
  providerSettings.classList.toggle('hidden',view!=='settings'||!currentUser);
  tasksView.classList.toggle('hidden',view!=='tasks'||!currentUser);
  filesView.classList.toggle('hidden',view!=='files'||!currentUser);
  if(view==='tasks'&&!currentUser){
    infoView.classList.remove('hidden');
    document.getElementById('infoTitle').textContent='Sign in required';
    document.getElementById('infoText').textContent='Sign in to create and manage your private agent tasks.';
  }
  if(view==='tasks'&&currentUser)loadAgentTasks();
  if(view==='settings'&&!currentUser){
    infoView.classList.remove('hidden');
    document.getElementById('infoTitle').textContent='Sign in required';
    document.getElementById('infoText').textContent='Sign in to manage your private AI provider credentials.';
  }
  if(view==='files'&&!currentUser){
    infoView.classList.remove('hidden');
    document.getElementById('infoTitle').textContent='Sign in required';
    document.getElementById('infoText').textContent='Sign in to view your private task workspace files.';
  }
  if(view==='settings'&&currentUser)loadProviderSettings();
  if(view==='files'&&currentUser)loadFiles();
  if(view!=='chat'&&view!=='settings'&&view!=='tasks'&&view!=='files'){
    document.getElementById('infoTitle').textContent=labels[view];
    document.getElementById('infoText').textContent=descriptions[view]||'This module is planned.';
  }
  document.getElementById('sidebar').classList.remove('open');
}
document.querySelectorAll('.nav-item').forEach(item=>item.addEventListener('click',()=>showView(item.dataset.view)));
document.getElementById('menuToggle').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key==='Enter')chatForm.requestSubmit();
});
setAuthMode(false);
loadSession();
