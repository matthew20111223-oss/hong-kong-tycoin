const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static(__dirname));
app.get("/health", (_, res) => res.json({ ok: true, game: "Hong Kong Tycoon" }));

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const START_CASH = 1500;
const MAX_PLAYERS = 20;
const tiles = [
  ["起點", "start", 0], ["深水埗", "property", 60], ["公共基金", "fund", 0], ["旺角", "property", 80],
  ["差餉及地租", "tax", 100], ["港鐵・荃灣線", "rail", 200], ["太子", "property", 100], ["機會", "chance", 0],
  ["油麻地", "property", 100], ["佐敦", "property", 120], ["探訪監獄", "visit", 0], ["尖沙咀", "property", 140],
  ["電力公司", "utility", 150], ["麼地道", "property", 140], ["廣東道", "property", 160], ["港鐵・港島線", "rail", 200],
  ["中環", "property", 180], ["公共基金", "fund", 0], ["金鐘", "property", 180], ["灣仔", "property", 200],
  ["免費泊車", "parking", 0], ["銅鑼灣", "property", 220], ["機會", "chance", 0], ["天后", "property", 220],
  ["北角", "property", 240], ["港鐵・將軍澳線", "rail", 200], ["太古", "property", 260], ["鰂魚涌", "property", 260],
  ["水務公司", "utility", 150], ["西灣河", "property", 280], ["入獄", "jail", 0], ["淺水灣", "property", 300],
  ["赤柱", "property", 300], ["公共基金", "fund", 0], ["山頂", "property", 320], ["港鐵・東鐵線", "rail", 200],
  ["機會", "chance", 0], ["香港迪士尼", "property", 350], ["奢侈稅", "tax", 100], ["維多利亞港", "property", 400]
].map((t, i) => ({ id:i, name:t[0], type:t[1], price:t[2], owner:null, houses:0, hotel:false }));

function publicRoom(room) {
  return { code:room.code, status:room.status, current:room.current, players:room.players.map(p=>({
    id:p.id, name:p.name, color:p.color, cash:p.cash, pos:p.pos, jailed:p.jailed, bankrupt:p.bankrupt,
    connected:p.connected, properties:p.properties, pendingBuy:p.pendingBuy
  })), tiles:room.tiles, log:room.log.slice(-18), winner:room.winner, lastRoll:room.lastRoll };
}
function log(room, message) { room.log.push({ message, at:Date.now() }); room.log=room.log.slice(-50); }
function player(room,id) { return room.players.find(p=>p.id===id); }
function activePlayers(room) { return room.players.filter(p=>!p.bankrupt); }
function nextTurn(room) {
  const alive=activePlayers(room);
  if(alive.length<=1){ room.status="finished"; room.winner=alive[0]?.id || null; log(room, alive[0] ? `${alive[0].name} 成為香港地產大亨！` : "遊戲結束"); return; }
  let idx=room.players.findIndex(p=>p.id===room.current);
  for(let n=0;n<room.players.length;n++){ idx=(idx+1)%room.players.length; if(!room.players[idx].bankrupt){room.current=room.players[idx].id;break;} }
}
function pay(room, from, to, amount) {
  amount=Math.max(0,Math.floor(amount));
  from.cash-=amount;
  if(to) to.cash+=amount;
  if(from.cash<0){ from.bankrupt=true; from.cash=0; room.tiles.forEach(t=>{if(t.owner===from.id){t.owner=null;t.houses=0;t.hotel=false;}}); from.properties=[]; log(room,`${from.name} 資金耗盡，宣告破產！`); }
}
function land(room,p) {
  const t=room.tiles[p.pos];
  if(t.type==="property"||t.type==="rail"||t.type==="utility"){
    if(!t.owner){ if(p.cash>=t.price){p.pendingBuy=t.id;log(room,`${p.name} 到達${t.name}，可用 $${t.price} 購買`);} else log(room,`${p.name} 到達${t.name}，但資金不足`); }
    else if(t.owner!==p.id){ const owner=player(room,t.owner); if(owner&&!owner.bankrupt){let rent=t.type==="property"?Math.max(10,Math.round(t.price*.12*(1+t.houses*.7)*(t.hotel?3:1))):t.type==="rail"?50:40;pay(room,p,owner,rent);log(room,`${p.name} 支付 $${rent} 租金予 ${owner.name}`);} }
  } else if(t.type==="tax"){pay(room,p,null,t.price);log(room,`${p.name} 繳付 $${t.price} 稅款`);}
  else if(t.type==="fund"){let amount=100;pay(room,null,p,0);p.cash+=amount;log(room,`${p.name} 從公共基金獲得 $${amount}`);}
  else if(t.type==="chance"){const cards=[{d:150,s:"獲得投資回報"},{d:-100,s:"維修及管理費"},{d:200,s:"幸運抽獎獎金"},{d:-50,s:"交通及雜費"}];const c=cards[Math.floor(Math.random()*cards.length)];p.cash+=c.d;log(room,`${p.name} 抽到機會卡：${c.s}（${c.d>=0?"+":""}$${c.d}）`);}
  else if(t.type==="jail"){p.pos=10;p.jailed=true;log(room,`${p.name} 被送入監獄`);}
  else if(t.type==="start"){p.cash+=200;log(room,`${p.name} 經過起點，獲得 $200`);}
  else if(t.type==="parking"){p.cash+=50;log(room,`${p.name} 在免費泊車位獲得 $50`);}
}
function roomCode(){return crypto.randomBytes(3).toString("hex").toUpperCase();}
io.on("connection", socket=>{
  socket.on("createRoom", ({name})=>{
    const code=roomCode(), id=socket.id;
    const room={code,status:"lobby",current:id,players:[],tiles:tiles.map(t=>({...t})),log:[],winner:null};
    room.players.push({id,name:String(name||"玩家").slice(0,16),color:"#d8aa54",cash:START_CASH,pos:0,jailed:false,bankrupt:false,connected:true,properties:[]});
    rooms.set(code,room);socket.join(code);socket.emit("joined",{code,playerId:id});io.to(code).emit("state",publicRoom(room));
  });
  socket.on("joinRoom",({code,name})=>{
    code=String(code||"").toUpperCase().trim();const room=rooms.get(code);
    if(!room)return socket.emit("errorMsg","找不到房間，請檢查房間碼。");
    if(room.status!=="lobby")return socket.emit("errorMsg","遊戲已經開始，不能加入。");
    if(room.players.length>=MAX_PLAYERS)return socket.emit("errorMsg","房間已滿（最多 20 人）。");
    if(room.players.some(p=>p.name===String(name||"").slice(0,16)))return socket.emit("errorMsg","房間內已有相同名稱，請更改名稱。");
    const colors=["#65b9a5","#e27c72","#8f9ee8","#c28add","#d8aa54","#72a6d5","#d68fba","#a4bd69"];
    const p={id:socket.id,name:String(name||"玩家").slice(0,16),color:colors[room.players.length%colors.length],cash:START_CASH,pos:0,jailed:false,bankrupt:false,connected:true,properties:[]};
    room.players.push(p);socket.join(code);socket.emit("joined",{code,playerId:socket.id});log(room,`${p.name} 加入房間`);io.to(code).emit("state",publicRoom(room));
  });
  socket.on("startGame",({code})=>{const r=rooms.get(code);if(!r||r.players[0]?.id!==socket.id||r.players.length<2)return; r.status="playing";log(r,"遊戲開始！祝各位好運。");io.to(code).emit("state",publicRoom(r));});
  socket.on("roll",({code})=>{
    const r=rooms.get(code),p=r&&player(r,socket.id);if(!r||r.status!=="playing"||r.current!==socket.id||!p||p.bankrupt)return;
    if(p.jailed){p.jailed=false;log(r,`${p.name} 離開監獄`);}
    const a=1+Math.floor(Math.random()*6),b=1+Math.floor(Math.random()*6),steps=a+b,old=p.pos;p.pos=(p.pos+steps)%40;
    if(p.pos<old){p.cash+=200;log(r,`${p.name} 經過起點，獲得 $200`);}
    log(r,`${p.name} 擲出 ${a} + ${b}，前進 ${steps} 格`);land(r,p);r.lastRoll={player:p.id,a,b};io.to(code).emit("state",publicRoom(r));
  });
  socket.on("buy",({code})=>{const r=rooms.get(code),p=r&&player(r,socket.id);if(!r||!p||r.current!==p.id||p.pendingBuy==null)return;const t=r.tiles[p.pendingBuy];if(t&&!t.owner&&p.cash>=t.price){p.cash-=t.price;t.owner=p.id;p.properties.push(t.id);log(r,`${p.name} 購入${t.name}（$${t.price}）`);}delete p.pendingBuy;io.to(code).emit("state",publicRoom(r));});
  socket.on("declineBuy",({code})=>{const r=rooms.get(code),p=r&&player(r,socket.id);if(!r||!p||r.current!==p.id)return;delete p.pendingBuy;log(r,`${p.name} 放棄購買`);io.to(code).emit("state",publicRoom(r));});
  socket.on("build",({code,tileId})=>{const r=rooms.get(code),p=r&&player(r,socket.id),t=r?.tiles[tileId];if(!r||!p||r.current!==p.id||!t||t.owner!==p.id||t.type!=="property"||p.cash<100||t.hotel)return;p.cash-=100;if(t.houses<4)t.houses++;else t.hotel=true;log(r,`${p.name} 在${t.name}興建${t.hotel?"酒店":"房屋"}`);io.to(code).emit("state",publicRoom(r));});
  socket.on("endTurn",({code})=>{const r=rooms.get(code),p=r&&player(r,socket.id);if(!r||!p||r.current!==p.id||r.status!=="playing")return;delete p.pendingBuy;nextTurn(r);io.to(code).emit("state",publicRoom(r));});
  socket.on("disconnect",()=>{for(const r of rooms.values()){const p=player(r,socket.id);if(p){p.connected=false;log(r,`${p.name} 連線中斷`);io.to(r.code).emit("state",publicRoom(r));}}});
});
server.listen(PORT,()=>console.log(`Hong Kong Tycoon running on ${PORT}`));
