const socket = io();
const $ = id => document.getElementById(id);
let currentRoom = null, isHost = false, roomState = null, lastSyncAt = 0;
const video = $("video");
let toastTimer;
function toast(msg) { const el=$("toast"); el.textContent=msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2600); }
function name() { return $("displayName").value.trim().slice(0,24) || "Guest"; }
function emitRoom(event, payload={}) { if (!currentRoom) return; socket.emit(event, {code:currentRoom, ...payload}); }
function enterRoom(room) {
  currentRoom=room.code; roomState=room; isHost=room.hostId===socket.id;
  $("lobby").classList.add("hidden"); $("watchApp").classList.remove("hidden");
  renderRoom(room); toast("You're in room " + room.code);
}
$("createBtn").onclick=()=>socket.emit("room:create",{name:name()},res=>{if(res?.ok) enterRoom(res.room);});
$("joinBtn").onclick=()=>socket.emit("room:join",{code:$("roomCode").value,name:name()},res=>{if(res?.ok) enterRoom(res.room);else toast(res?.error||"Could not join room");});
$("roomCode").addEventListener("keydown",e=>{if(e.key==="Enter")$("joinBtn").click();});
$("copyInvite").onclick=async()=>{try{await navigator.clipboard.writeText(currentRoom);toast("Room code copied! Share it with your friends.");}catch{toast("Your room code is "+currentRoom);}};
function renderRoom(room) {
  roomState=room; isHost=room.hostId===socket.id;
  $("roomTitle").textContent=room.title||"Movie night";
  $("roomMeta").textContent=`Room code: ${room.code} · ${room.users.length} watching`;
  $("peopleCount").textContent=room.users.length;
  $("hostStatus").textContent=isHost?"YOU ARE THE HOST":"HOST: "+(room.hostName||"Guest").toUpperCase();
  $("hostTools").classList.toggle("hidden",!isHost);
  $("pollCreator").classList.toggle("hidden",!isHost);
  $("peopleList").innerHTML="";
  room.users.forEach(u=>{
    const row=document.createElement("div"); row.className="person";
    const avatar=document.createElement("div");avatar.className="avatar";avatar.textContent=(u.name[0]||"G").toUpperCase();
    const nm=document.createElement("span");nm.className="person-name";nm.textContent=u.name+(u.id===socket.id?" (you)":"");
    row.append(avatar,nm);
    if(u.id===room.hostId){const tag=document.createElement("span");tag.className="host-tag";tag.textContent="HOST";row.append(tag);}
    else if(isHost){const btn=document.createElement("button");btn.className="secondary";btn.textContent="Make host";btn.style.padding="6px 8px";btn.style.fontSize="10px";btn.onclick=()=>emitRoom("host:transfer",{userId:u.id});row.append(btn);}
    $("peopleList").append(row);
  });
  renderPlaylist(room.playlist||[]); renderPoll(room.poll);
  if(room.videoUrl && video.dataset.url!==room.videoUrl) setVideo(room.videoUrl,room.title,room.position,room.playing,room.updatedAt);
  else if(!room.videoUrl){$("videoPlaceholder").classList.remove("hidden");}
}
function setVideo(url,title,position=0,playing=false,updatedAt=Date.now()) {
  if(!url)return;
  const changed=video.dataset.url!==url;
  video.dataset.url=url; $("videoTitle").value=title||"";
  if(changed){video.src=url;video.load();$("videoPlaceholder").classList.add("hidden");}
  const expected=position+(playing?Math.max(0,(Date.now()-updatedAt)/1000):0);
  const apply=()=>{try{if(Number.isFinite(expected)&&Math.abs(video.currentTime-expected)>0.7)video.currentTime=expected;}catch{}; if(playing)video.play().catch(()=>toast("Press play once to allow browser playback."));else video.pause();};
  if(video.readyState>=1)apply();else video.addEventListener("loadedmetadata",apply,{once:true});
}
$("loadVideo").onclick=()=>{
  if(!isHost)return;
  const url=$("videoUrl").value.trim(),title=$("videoTitle").value.trim()||"Movie night";
  if(!url){toast("Paste a direct MP4/WebM video URL first.");return;}
  if(!/^https?:\/\//i.test(url)){toast("Please enter a valid http/https video URL.");return;}
  emitRoom("playback:command",{action:"load",videoUrl:url,title,position:0}); toast("Video link sent to everyone.");
};
video.addEventListener("play",()=>{if(isHost&&currentRoom){emitRoom("playback:command",{action:"play",position:video.currentTime});}});
video.addEventListener("pause",()=>{if(isHost&&currentRoom&&!video.ended){emitRoom("playback:command",{action:"pause",position:video.currentTime});}});
video.addEventListener("seeked",()=>{if(isHost&&currentRoom)emitRoom("playback:command",{action:"seek",position:video.currentTime});});
setInterval(()=>{if(isHost&&currentRoom&&!video.paused&&!video.ended)emitRoom("playback:heartbeat",{position:video.currentTime,playing:!video.paused});},2000);
socket.on("playback:sync",data=>{
  if(!currentRoom)return;lastSyncAt=Date.now();
  if(data.videoUrl)setVideo(data.videoUrl,data.title,data.position,data.playing,data.updatedAt);
  $("syncStatus").textContent="● Syncing";
  setTimeout(()=>$("syncStatus").textContent="● Synced",500);
});
video.addEventListener("timeupdate",()=>{
  if(!currentRoom||isHost||video.paused||!roomState?.playing)return;
  // Small drift correction keeps clients aligned with the host clock.
  const expected=roomState.position+Math.max(0,(Date.now()-roomState.updatedAt)/1000);
  const drift=expected-video.currentTime;
  $("driftText").textContent=`Playback drift: ${Math.abs(drift).toFixed(2)}s`;
  if(Math.abs(drift)>0.5){video.playbackRate=drift>0?1.06:0.94;}
  else video.playbackRate=1;
});
socket.on("room:update",room=>{if(currentRoom===room.code)renderRoom(room);});
socket.on("room:state",room=>{if(currentRoom===room.code)renderRoom(room);});
socket.on("chat:system",text=>addSystem(text));
function addSystem(text){const el=document.createElement("div");el.className="system-message";el.textContent=text;$("chatMessages").append(el);$("chatMessages").scrollTop=$("chatMessages").scrollHeight;}
function addMessage(msg){const el=document.createElement("div");el.className="chat-bubble";const b=document.createElement("b");b.textContent=msg.name;const body=document.createElement("span");body.textContent=msg.text;const time=document.createElement("time");time.textContent=msg.time;el.append(b,body,time);$("chatMessages").append(el);$("chatMessages").scrollTop=$("chatMessages").scrollHeight;}
socket.on("chat:message",addMessage);
$("chatForm").addEventListener("submit",e=>{e.preventDefault();const message=$("chatInput").value.trim();if(message){emitRoom("chat:send",{message});$("chatInput").value="";}});
document.querySelectorAll("[data-emoji]").forEach(btn=>btn.onclick=()=>emitRoom("reaction:send",{emoji:btn.dataset.emoji}));
socket.on("reaction:show",data=>{const el=document.createElement("span");el.className="emoji-float";el.textContent=data.emoji;el.style.setProperty("--x",`${Math.random()*100-50}px`);$("reactionLayer").append(el);setTimeout(()=>el.remove(),1800);});
$("addPlaylist").onclick=()=>{const title=$("playlistTitle").value.trim(),url=$("playlistUrl").value.trim();if(!title||!url)return toast("Add a title and video URL.");emitRoom("playlist:add",{title,url});$("playlistTitle").value="";$("playlistUrl").value="";};
function renderPlaylist(items){const box=$("playlist");box.innerHTML="";if(!items.length){box.className="playlist-empty";box.textContent="Your shared playlist is waiting for its first pick.";return;}box.className="";items.forEach((item,i)=>{const row=document.createElement("div");row.className="playlist-item";const n=document.createElement("div");n.className="playlist-num";n.textContent=String(i+1).padStart(2,"0");const info=document.createElement("div");info.className="playlist-info";const title=document.createElement("b");title.textContent=item.title;const small=document.createElement("small");small.textContent="Added by "+item.addedBy;info.append(title,small);row.append(n,info);const btn=document.createElement("button");btn.className="secondary";btn.textContent=isHost?"▶ Play":"Queued";btn.disabled=!isHost;btn.onclick=()=>emitRoom("playlist:play",{id:item.id});row.append(btn);box.append(row);});}
$("createPoll").onclick=()=>{const question=$("pollQuestion").value.trim();const options=[$("pollOption1").value,$("pollOption2").value,$("pollOption3").value,$("pollOption4").value].map(x=>x.trim()).filter(Boolean);if(!question||options.length<2)return toast("Add a question and at least two options.");emitRoom("poll:create",{question,options});};
function renderPoll(poll){const area=$("pollArea");area.innerHTML="";if(!poll){const p=document.createElement("p");p.className="muted";p.textContent="The host can start a quick vote.";area.append(p);return;}const q=document.createElement("b");q.textContent=poll.question;q.style.fontSize="13px";area.append(q);const total=poll.options.reduce((s,o)=>s+o.votes,0);poll.options.forEach((o,i)=>{const row=document.createElement("div");row.className="poll-option";const label=document.createElement("label");label.textContent=o.label;const vote=document.createElement("button");vote.className="secondary";vote.textContent="Vote";vote.style.padding="7px 9px";vote.onclick=()=>emitRoom("poll:vote",{index:i});const stat=document.createElement("small");stat.textContent=`${o.votes} vote${o.votes===1?"":"s"}`;const left=document.createElement("div");left.style.flex="1";left.append(label);const bar=document.createElement("div");bar.className="poll-bar";const fill=document.createElement("span");fill.style.width=(total?o.votes/total*100:0)+"%";bar.append(fill);left.append(bar);row.append(left,stat,vote);area.append(row);});}
socket.on("connect",()=>{});
