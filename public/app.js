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
let sending=false;
let registering=false;
let csrfToken=null;
let currentUser=null;

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
}
function setUnauthenticated(){
  currentUser=null;
  csrfToken=null;
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
      body:JSON.stringify({message:value})
    });
    const data=await response.json().catch(()=>({}));
    if(response.status===401){setUnauthenticated();throw new Error('Your session expired. Sign in again.');}
    if(!response.ok)throw new Error(data.error||'Request failed. Check the API server.');
    if(typeof data.answer!=='string')throw new Error('The server returned an invalid response.');
    addMessage(data.answer,'system');
    composerStatus.textContent='Connected · Provider key stays on server';
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
  promptInput.value='';
  showView('chat');
});
function showView(view){
  const labels={chat:'AI Workspace',agents:'Agents',tasks:'Tasks',files:'Files',memory:'Memory'};
  const descriptions={
    agents:'Create specialized agents, configure their tools and review permissions.',
    tasks:'Monitor queued, running, paused and completed agent tasks.',
    files:'Manage files generated or uploaded to your secure workspace.',
    memory:'Review, edit, export and delete information saved to your account.'
  };
  document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view===view));
  pageName.textContent=labels[view]||labels.chat;
  chatView.classList.toggle('hidden',view!=='chat');
  infoView.classList.toggle('hidden',view==='chat');
  if(view!=='chat'){
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
