const authScreen=document.getElementById('authScreen');
const appShell=document.querySelector('.app-shell');
const authPanel=document.getElementById('authPanel');
const authTitle=document.getElementById('authTitle');
const authSubtitle=document.getElementById('authSubtitle');
const authForm=document.getElementById('authForm');
const authSwitch=document.getElementById('authSwitch');
let authMode='login';

const savedUser=JSON.parse(localStorage.getItem('inkvio-user')||'null');
const session=localStorage.getItem('inkvio-session');
if(savedUser&&session) enterApp(savedUser,false); else showAuth();

function showAuth(){authScreen.hidden=false;appShell.hidden=true;renderAuth();}
function renderAuth(){
 const register=authMode==='register';
 authPanel.classList.remove('panel-pop'); void authPanel.offsetWidth; authPanel.classList.add('panel-pop');
 authTitle.textContent=register?'Build your print workspace':'Welcome back';
 authSubtitle.textContent=register?'Tell us about your shop. Inkvio will shape the workspace around your operation.':'Sign in to continue running your print business.';
 authForm.innerHTML=register?`
  <div class="auth-grid"><label class="auth-field"><span>Your name</span><input name="name" required placeholder="Jamie Mejia"></label><label class="auth-field"><span>Business name</span><input name="business" required placeholder="Your Print Studio"></label></div>
  <label class="auth-field"><span>Email address</span><input name="email" type="email" required placeholder="you@example.com"></label>
  <div class="auth-field"><span>What kind of operation are you running?</span><div class="size-picker"><label><input type="radio" name="size" value="small" checked><div class="size-card"><b>Small shop</b><small>Owner-led · 1–5 people</small><em>Simple workspace</em></div></label><label><input type="radio" name="size" value="big"><div class="size-card"><b>Growing / big shop</b><small>Team · multiple stations</small><em>Advanced operations</em></div></label></div></div>
  <label class="auth-field"><span>Password</span><div class="password-wrap"><input id="authPassword" name="password" type="password" minlength="6" required placeholder="At least 6 characters"><button type="button" onclick="togglePassword()">Show</button></div></label>
  <button class="auth-submit" type="submit"><span>Create my workspace</span><i>→</i></button>
 `:`
  <label class="auth-field"><span>Email address</span><input name="email" type="email" required placeholder="you@example.com"></label>
  <label class="auth-field"><span>Password</span><div class="password-wrap"><input id="authPassword" name="password" type="password" required placeholder="Enter your password"><button type="button" onclick="togglePassword()">Show</button></div></label>
  <div class="auth-meta"><label><input type="checkbox" checked> Remember me</label><button type="button" onclick="demoHint()">Forgot password?</button></div>
  <button class="auth-submit" type="submit"><span>Enter Inkvio</span><i>→</i></button>`;
 authSwitch.innerHTML=register?'Already have a workspace? <button type="button">Sign in</button>':`New to Inkvio? <button type="button">Create your workspace</button>`;
 authSwitch.querySelector('button').onclick=()=>{authMode=register?'login':'register';renderAuth()};
}

authForm.addEventListener('submit',e=>{
 e.preventDefault(); const f=new FormData(authForm); const stored=JSON.parse(localStorage.getItem('inkvio-user')||'null');
 if(authMode==='register'){
  const user={name:f.get('name'),business:f.get('business'),email:f.get('email'),password:f.get('password'),size:f.get('size')};
  localStorage.setItem('inkvio-user',JSON.stringify(user)); localStorage.setItem('inkvio-session','active'); launch(user,'Workspace created');
 }else{
  if(!stored){authMode='register';renderAuth();authToast('Create your workspace first.');return;}
  if(f.get('email')!==stored.email||f.get('password')!==stored.password){authToast('Email or password does not match this demo workspace.');return;}
  localStorage.setItem('inkvio-session','active');launch(stored,'Welcome back');
 }
});

function launch(user,msg){
 authScreen.classList.add('auth-exit');setTimeout(()=>{enterApp(user,true);authScreen.classList.remove('auth-exit');showToast(msg);},650);
}
function enterApp(user,animate){
 authScreen.hidden=true;appShell.hidden=false; if(animate){appShell.classList.add('app-enter');setTimeout(()=>appShell.classList.remove('app-enter'),900)}
 document.querySelector('.shop-copy strong').textContent=user.business||'My Print Shop';document.querySelector('.user-card strong').textContent=user.name||'Owner';
 document.querySelector('.shop-icon').textContent=(user.business||'PS').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
 document.querySelector('.avatar').textContent=(user.name||'Owner').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
 document.getElementById('pageTitle').textContent=`Good morning, ${(user.name||'Owner').split(' ')[0]}.`;
 document.body.dataset.shopSize=user.size||'small';
}
function togglePassword(){const p=document.getElementById('authPassword');const b=p.nextElementSibling;p.type=p.type==='password'?'text':'password';b.textContent=p.type==='password'?'Show':'Hide'}
function demoHint(){authToast('This static demo stores the account only on this browser.');}
function authToast(t){const el=document.getElementById('authToast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
window.inkvioLogout=()=>{localStorage.removeItem('inkvio-session');location.reload()};
