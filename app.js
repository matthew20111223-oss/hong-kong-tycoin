const socket=io();
const $=id=>document.getElementById(id);
let roomCode=null, myId=null, state=null, lastPending=null;
const colors=["#d8aa54","#65b9a5","#e27c72","#8f9ee8","#c28add","#72a6d5","#d68fba","#a4bd69"];
function toast(s){$("toast").textContent=s;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2400)}
function name(){return $("playerName").value.trim().slice(0,16)||"玩家"}
$("create").onclick=()=>socket.emit("createRoom",{name:name()});
$("join").onclick=()=>socket.emit("joinRoom",{code:$("roomCode").value,name:name()});
$("roomCode").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
$("copyCode").onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);toast("房間碼已複製！")}catch{toast("房間碼："+roomCode)}};
$("start").onclick=()=>socket.emit("startGame",{code:roomCode});
$("roll").onclick=()=>socket.emit("roll",{code:roomCode});
$("buy").onclick=()=>socket.emit("buy",{code:roomCode});
$("decline").onclick=()=>socket.emit("declineBuy",{code:roomCode});
$("end").onclick=()=>socket.emit("endTurn",{code:roomCode});
$("build").onclick=()=>{const p=state.players.find(x=>x.id===myId);socket.emit("build",{code:roomCode,tileId:p.pos})};
socket.on("joined",d=>{roomCode=d.code;myId=d.playerId;$("lobby").classList.add("hidden");$("game").classList.remove("hidden");$("codeText").textContent=roomCode;toast("成功加入房間 "+roomCode)});
socket.on("errorMsg",toast);
socket.on("state",s=>{state=s;render()});
function tilePosition(i){if(i<=10)return [10,i];if(i<=20)return [20-i,10];if(i<=30)return [0,30-i];return [i-30,0]}
function renderBoard(){
 const board=$("board");board.querySelectorAll(".tile").forEach(x=>x.remove());
 state.tiles.forEach((t,i)=>{const [r,c]=tilePosition(i),el=document.createElement("div");el.className="tile "+(["start","jail","visit","parking"].includes(t.type)?"corner":"")+(!["property","rail","utility"].includes(t.type)?" special":"")+(t.owner?" owner":"");
 el.style.gridRow=r+1;el.style.gridColumn=c+1;
 const bands={property:"#b96f5d",rail:"#536f8d",utility:"#6a9b83"};if(bands[t.type]){const band=document.createElement("div");band.className="band";band.style.background=bands[t.type];el.append(band)}
 const title=document.createElement("div");title.textContent=t.name;el.append(title);
 if(t.price){const price=document.createElement("div");price.className="price";price.textContent="$"+t.price;el.append(price)}
 if(t.houses||t.hotel){const h=document.createElement("div");h.className="housemark";h.textContent=t.hotel?"◆ HOTEL":"▰".repeat(t.houses);el.append(h)}
 const tokens=document.createElement("div");tokens.className="tokens";state.players.filter(p=>!p.bankrupt&&p.pos===i).forEach(p=>{const d=document.createElement("i");d.className="token";d.style.background=p.color;tokens.append(d)});el.append(tokens);
 if(t.owner){const owner=state.players.find(p=>p.id===t.owner);el.style.borderBottom="3px solid "+(owner?.color||"#333")}
 board.append(el);
 });
}
function render(){
 renderBoard();$("playerCount").textContent=state.players.length+" / 20";
 $("players").innerHTML="";state.players.forEach(p=>{const row=document.createElement("div");row.className="player";const dot=document.createElement("i");dot.className="dot";dot.style.background=p.color;const nm=document.createElement("span");nm.className="pname"+(p.id===myId?" you":"");nm.textContent=p.name+(p.id===myId?"（你）":"")+(p.bankrupt?" · 破產":"");const cash=document.createElement("span");cash.className="cash";cash.textContent="$"+p.cash.toLocaleString();row.append(dot,nm,cash);$("players").append(row)});
 const current=state.players.find(p=>p.id===state.current);$("turnLabel").textContent=state.status==="lobby"?"LOBBY":state.status==="finished"?"FINISHED":(current?current.name+" 的回合":"遊戲中");
 $("start").classList.toggle("hidden",!(state.status==="lobby"&&state.players[0]?.id===myId));$("start").disabled=state.players.length<2;
 const mine=state.players.find(p=>p.id===myId),isTurn=state.current===myId&&state.status==="playing";
 $("roll").disabled=!isTurn;$("end").disabled=!isTurn;
 const t=mine?state.tiles[mine.pos]:null;
 const pending=mine&&mine.pendingBuy!==undefined;
 $("buy").classList.toggle("hidden",!pending);$("decline").classList.toggle("hidden",!pending);
 $("build").classList.toggle("hidden",!(isTurn&&t&&t.owner===myId&&t.type==="property"&&mine.cash>=100&&!t.hotel));
 if(state.status==="lobby")$("actionText").textContent=state.players.length<2?"等待朋友加入房間……":"玩家已到齊，房主可以開始遊戲。";
 else if(state.status==="finished")$("actionText").textContent="遊戲結束！"+(state.players.find(p=>p.id===state.winner)?.name||"無人")+" 成為香港地產大亨。";
 else if(isTurn)$("actionText").textContent=pending?"你可以購買 "+t.name+"（$"+t.price+"），或者放棄。":"輪到你了。擲骰子開始行動。";
 else $("actionText").textContent="等待 "+(current?.name||"其他玩家")+" 行動……";
 $("feed").innerHTML="";[...state.log].reverse().forEach(item=>{const d=document.createElement("div");d.className="feeditem";d.textContent=item.message;$("feed").append(d)});
 if(state.lastRoll){$("dice").textContent="⚄ "+state.lastRoll.a+"　⚅ "+state.lastRoll.b;$("rollHint").textContent="最近一次擲骰結果"} 
}
