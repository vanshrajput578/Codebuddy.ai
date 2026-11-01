const messages=document.getElementById('messages');
const promptInput=document.getElementById('prompt');
const chatForm=document.getElementById('chatForm');
const chatView=document.getElementById('chatView');
const infoView=document.getElementById('infoView');
const pageName=document.getElementById('pageName');
const composerStatus=document.querySelector('.composer-footer span');
const sendButton=chatForm.querySelector('.send-button');
let sending=false;

function addMessage(text,kind){
  const node=document.createElement('div');
  node.className='message '+kind;
  node.textContent=text;
  messages.appendChild(node);
  node.scrollIntoView({behavior:'smooth',block:'nearest'});
}
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
      headers:{'Content-Type':'application/json'},
      credentials:'same-origin',
      cache:'no-store',
      body:JSON.stringify({message:value})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Request failed. Check the API server.');
    if(typeof data.answer!=='string')throw new Error('The server returned an invalid response.');
    addMessage(data.answer,'system');
    composerStatus.textContent='Connected · Provider key stays on server';
  }catch(error){
    addMessage(error.message||'Unable to reach the NEXUS API. Confirm that the backend is running and /api is reverse-proxied to it.','system');
    composerStatus.textContent='Backend unavailable · Check server';
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
