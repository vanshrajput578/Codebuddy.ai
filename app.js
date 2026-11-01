const messages=document.getElementById('messages');
const promptInput=document.getElementById('prompt');
const chatForm=document.getElementById('chatForm');
const chatView=document.getElementById('chatView');
const infoView=document.getElementById('infoView');
const pageName=document.getElementById('pageName');
function addMessage(text,kind){const node=document.createElement('div');node.className='message '+kind;node.textContent=text;messages.appendChild(node);node.scrollIntoView({behavior:'smooth',block:'nearest'});}
function sendPreviewMessage(text){const value=String(text||'').trim();if(!value)return;addMessage(value,'user');addMessage('This repository currently contains the NEXUS AI frontend preview only. No AI provider or backend is connected, so this message has not been processed by an AI model. The next implementation phase is the secure API, provider router and persistent chat.','system');}
chatForm.addEventListener('submit',event=>{event.preventDefault();sendPreviewMessage(promptInput.value);promptInput.value='';});
document.querySelectorAll('.suggestion').forEach(button=>button.addEventListener('click',()=>{promptInput.value=button.dataset.prompt||'';promptInput.focus();}));
document.getElementById('newChat').addEventListener('click',()=>{messages.replaceChildren();promptInput.value='';showView('chat');});
function showView(view){const labels={chat:'AI Workspace',agents:'Agents',tasks:'Tasks',files:'Files',memory:'Memory'};const descriptions={agents:'Create specialized agents, configure their tools and review permissions.',tasks:'Monitor queued, running, paused and completed agent tasks.',files:'Manage files generated or uploaded to your secure workspace.',memory:'Review, edit, export and delete information saved to your account.'};document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view===view));pageName.textContent=labels[view]||labels.chat;chatView.classList.toggle('hidden',view!=='chat');infoView.classList.toggle('hidden',view==='chat');if(view!=='chat'){document.getElementById('infoTitle').textContent=labels[view];document.getElementById('infoText').textContent=descriptions[view]||'This module is planned.';}document.getElementById('sidebar').classList.remove('open');}
document.querySelectorAll('.nav-item').forEach(item=>item.addEventListener('click',()=>showView(item.dataset.view)));
document.getElementById('menuToggle').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter')chatForm.requestSubmit();});
