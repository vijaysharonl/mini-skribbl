const socket = io();

let roomCode = null;
let isDrawer = false;
let isHost = false;
let drawing = false;
let color = "#000000";
let size = 6;

const home = document.getElementById("home");
const game = document.getElementById("game");
const board = document.getElementById("board");
const ctx = board.getContext("2d");
// Auto-resize canvas for mobile screens
function resizeCanvas() {
  const width = Math.min(window.innerWidth * 0.9, 900);
  const height = width * 0.75;
  board.width = width;
  board.height = height;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();


const playerNameInput = document.getElementById("playerName");
const joinCodeInput = document.getElementById("joinCode");
const errorText = document.getElementById("error");
const roomInfo = document.getElementById("roomInfo");
const drawerWord = document.getElementById("drawerWord");
const playersDiv = document.getElementById("players");
const scoresDiv = document.getElementById("scores");
const chatDiv = document.getElementById("chat");
const startBtn = document.getElementById("startGame"); // host start button

/* -------------------- LOBBY BUTTONS -------------------- */
document.getElementById("createRoom").addEventListener("click", () => {
  const name = playerNameInput.value.trim();
  if (!name) return (errorText.textContent = "Enter your name!");
  socket.emit("createRoom", name);
});

document.getElementById("joinRoom").addEventListener("click", () => {
  const name = playerNameInput.value.trim();
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!name || !code) return (errorText.textContent = "Enter name & room code!");
  socket.emit("joinRoom", { roomCode: code, playerName: name });
});

/* -------------------- SERVER RESPONSES -------------------- */
socket.on("roomCreated", (code) => {
  roomCode = code;
  isDrawer = false;
  isHost = true;
  enterGame(code);
  startBtn.style.display = "inline-block"; // host sees start button
});

socket.on("joinedRoom", (code) => {
  roomCode = code;
  isDrawer = false;
  isHost = false;
  enterGame(code);
});

socket.on("errorMessage", (msg) => (errorText.textContent = msg));

socket.on("playerList", (players) => {
  playersDiv.innerHTML = players
    .map(
      (p) => `
      <div class="playerCard">
        <div class="avatar" style="background:${p.color};"></div>
        <div class="playerInfo">
          <span class="playerName">${p.name}</span>
          <span class="playerScore">${p.score || 0} pts</span>
        </div>
      </div>`
    )
    .join("");
});

socket.on("updateScores", (players) => {
  scoresDiv.innerHTML = players.map((p) => `${p.name}: ${p.score}`).join("<br>");
});

socket.on("drawerChanged", ({ drawerName }) => {
  if (!isDrawer) {
    drawerWord.textContent = `${drawerName} is drawing...`;
  }
  isDrawer = false; // make sure you reset yourself as guesser
});

socket.on("setDrawer", ({ word }) => {
  isDrawer = true;
  drawerWord.textContent = `Your word: ${word}`;
  document.getElementById("hintWord").textContent = "";
});


socket.on("message", (msg) => {
  const div = document.createElement("div");
  div.textContent = msg;
  chatDiv.appendChild(div);
  chatDiv.scrollTop = chatDiv.scrollHeight;
});

socket.on("guess", ({ roomCode, guess }) => {
  const room = rooms[roomCode];
  if (!room || !room.word || !room.gameActive) return;

  const name = room.players[socket.id]?.name || "Player";
  const correct = guess.trim().toLowerCase() === room.word.toLowerCase();

  if (correct) {
    room.players[socket.id].score += 10;
    io.to(roomCode).emit("message", `✅ ${name} guessed it right!`);
    io.to(roomCode).emit("updateScores", Object.values(room.players));
    clearInterval(room.timer);
    setTimeout(() => nextRound(roomCode), 2000); // short pause
  } else {
    io.to(roomCode).emit("message", `${name}: ${guess}`);
  }
});



/* -------------------- GAME CONTROL -------------------- */
// Host can start game manually
startBtn.addEventListener("click", () => {
  socket.emit("startGame");
  startBtn.style.display = "none"; // hide after pressing
});

/* -------------------- DRAWER WORD + HINT + TIMER -------------------- */
socket.on("setDrawer", ({ word }) => {
  isDrawer = true;
  drawerWord.textContent = `Your word: ${word}`;
  document.getElementById("hintWord").textContent = "";
});

socket.on("showHint", ({ hint }) => {
  if (!isDrawer) document.getElementById("hintWord").textContent = `Hint: ${hint}`;
});

socket.on("timerUpdate", (secondsLeft) => {
  const timerFill = document.getElementById("timerFill");
  timerFill.style.width = `${(secondsLeft / 80) * 100}%`;
});

/* -------------------- DRAWING UX -------------------- */
const colorPicker = document.getElementById("colorPicker");
const brushSize = document.getElementById("brushSize");
const clearBtn = document.getElementById("clearBtn");

colorPicker.addEventListener("change", (e) => (color = e.target.value));
brushSize.addEventListener("input", (e) => (size = Number(e.target.value)));
clearBtn.addEventListener("click", () => {
  if (!isDrawer) return;
  clearCanvas();
  socket.emit("clearCanvas", { roomCode });
});

// Mouse events
board.addEventListener("mousedown", (e) => {
  if (!isDrawer) return;
  drawing = true;
  ctx.beginPath();
  ctx.moveTo(e.offsetX, e.offsetY);
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  socket.emit("startDrawing", { roomCode, x: e.offsetX, y: e.offsetY, color, size });
});

board.addEventListener("mousemove", (e) => {
  if (!isDrawer || !drawing) return;
  ctx.lineTo(e.offsetX, e.offsetY);
  ctx.stroke();
  socket.emit("drawing", { roomCode, x: e.offsetX, y: e.offsetY });
});

board.addEventListener("mouseup", () => {
  if (!isDrawer) return;
  drawing = false;
  ctx.beginPath();
  socket.emit("stopDrawing", { roomCode });
});

board.addEventListener("mouseleave", () => {
  if (!isDrawer) return;
  drawing = false;
  ctx.beginPath();
  socket.emit("stopDrawing", { roomCode });
});

/* -------------------- TOUCH SUPPORT -------------------- */
/* -------------------- TOUCH SUPPORT (Improved) -------------------- */
board.addEventListener(
  "touchstart",
  (e) => {
    if (!isDrawer) return;
    e.preventDefault();
    const rect = board.getBoundingClientRect();
    const touch = e.touches[0];
    const x = ((touch.clientX - rect.left) / rect.width) * board.width;
    const y = ((touch.clientY - rect.top) / rect.height) * board.height;
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    socket.emit("startDrawing", { roomCode, x, y, color, size });
  },
  { passive: false }
);

board.addEventListener(
  "touchmove",
  (e) => {
    if (!isDrawer || !drawing) return;
    e.preventDefault();
    const rect = board.getBoundingClientRect();
    const touch = e.touches[0];
    const x = ((touch.clientX - rect.left) / rect.width) * board.width;
    const y = ((touch.clientY - rect.top) / rect.height) * board.height;
    ctx.lineTo(x, y);
    ctx.stroke();
    socket.emit("drawing", { roomCode, x, y });
  },
  { passive: false }
);

board.addEventListener(
  "touchend",
  (e) => {
    if (!isDrawer) return;
    e.preventDefault();
    drawing = false;
    ctx.beginPath();
    socket.emit("stopDrawing", { roomCode });
  },
  { passive: false }
);

/* -------------------- MIRROR REMOTE DRAWING -------------------- */
socket.on("startDrawing", ({ x, y, color, size }) => {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
});


socket.on("drawing", ({ x, y }) => {
  ctx.lineTo(x, y);
  ctx.stroke();
});

socket.on("stopDrawing", () => {
  ctx.beginPath();
});

socket.on("clearCanvas", () => clearCanvas());

/* -------------------- GUESS INPUT -------------------- */
document.getElementById("sendGuess").addEventListener("click", sendGuess);
document.getElementById("guessInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendGuess();
});

function sendGuess() {
  const input = document.getElementById("guessInput");
  const guess = input.value.trim();
  if (!guess) return;
  socket.emit("guess", { roomCode, guess });
  input.value = "";
}

/* -------------------- HELPERS -------------------- */
function enterGame(code) {
  roomInfo.textContent = `Room: ${code}`;
  drawerWord.textContent = "";
  home.style.display = "none";
  game.style.display = "block";
  clearCanvas();
}

// ===== LOCK CANVAS SIZE AFTER INITIAL LOAD =====
function lockCanvasSize() {
  const rect = board.getBoundingClientRect();
  board.width = rect.width;
  board.height = rect.height;
}

// Prevent viewport resize from redrawing canvas
window.visualViewport?.addEventListener("resize", (e) => {
  e.preventDefault();
  e.stopPropagation();
});

window.addEventListener("load", lockCanvasSize);


function clearCanvas() {
  ctx.clearRect(0, 0, board.width, board.height);
}
