const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};
const words = [
  "apple","tree","car","sun","phone","pizza","book","river","computer",
  "house","dog","cat","ball","camera","rain","ocean","planet","shoe"
];
const colors = ["#ef4444","#10b981","#3b82f6","#f59e0b","#8b5cf6","#ec4899"];

function genRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on("connection", (socket) => {
  socket.data.roomCode = null;
  socket.data.name = null;

  // Create room
  socket.on("createRoom", (name) => {
    const roomCode = genRoomCode();
    rooms[roomCode] = {
      host: socket.id,
      players: {},
      drawer: null,
      drawerIndex: 0,
      word: "",
      hint: "",
      timer: null,
      timeLeft: 0,
      gameActive: false
    };

    const color = colors[Math.floor(Math.random() * colors.length)];
    rooms[roomCode].players[socket.id] = { name, score: 0, color };

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.name = name;

    socket.emit("roomCreated", roomCode);
    io.to(roomCode).emit("playerList", Object.values(rooms[roomCode].players));
  });

  // Join room
  socket.on("joinRoom", ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit("errorMessage", "Room not found!");

    const color = colors[Math.floor(Math.random() * colors.length)];
    room.players[socket.id] = { name: playerName, score: 0, color };

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.name = playerName;

    socket.emit("joinedRoom", roomCode);
    io.to(roomCode).emit("playerList", Object.values(room.players));
  });

  // Host starts game manually
  socket.on("startGame", () => {
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    if (!room || socket.id !== room.host) return;
    if (room.gameActive) return;

    room.gameActive = true;
    room.drawerIndex = 0;
    startRound(roomCode);
  });

  // Drawing events
  socket.on("startDrawing", (data) => forwardIfDrawer(socket, "startDrawing", data));
  socket.on("drawing", (data) => forwardIfDrawer(socket, "drawing", data));
  socket.on("stopDrawing", (data) => forwardIfDrawer(socket, "stopDrawing", data));
  socket.on("clearCanvas", (data) => forwardIfDrawer(socket, "clearCanvas", data));

  function forwardIfDrawer(socket, event, data) {
    const room = rooms[socket.data.roomCode];
    if (!room || socket.id !== room.drawer) return;
    socket.to(socket.data.roomCode).emit(event, data);
  }

  // Guessing
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
      setTimeout(() => rotateDrawer(roomCode), 1500);
    } else {
      io.to(roomCode).emit("message", `${name}: ${guess}`);
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];
    delete room.players[socket.id];

    io.to(roomCode).emit("playerList", Object.values(room.players));

    if (socket.id === room.drawer) {
      clearInterval(room.timer);
      rotateDrawer(roomCode);
    }

    if (Object.keys(room.players).length === 0) delete rooms[roomCode];
  });
});

/* -------------------- GAME FLOW -------------------- */
function startRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const ids = Object.keys(room.players);
  if (ids.length < 2) {
    io.to(roomCode).emit("message", "Need at least 2 players!");
    room.gameActive = false;
    return;
  }

  // pick drawer by rotation index
  const drawerId = ids[room.drawerIndex % ids.length];
  room.drawer = drawerId;
  const drawerName = room.players[drawerId].name;

  // pick a word
  room.word = words[Math.floor(Math.random() * words.length)];
  room.hint = room.word.split("").map(() => "_").join(" ");
  room.timeLeft = 80;

  io.to(roomCode).emit("clearCanvas");
  io.to(roomCode).emit("message", `🖊️ ${drawerName} is drawing now!`);
  io.to(roomCode).emit("updateScores", Object.values(room.players));

  io.to(drawerId).emit("setDrawer", { word: room.word });
  ids.forEach((id) => {
    if (id !== drawerId) {
      io.to(id).emit("drawerChanged", { drawerName });
      io.to(id).emit("showHint", { hint: room.hint });
    }
  });

  if (room.timer) clearInterval(room.timer);
  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(roomCode).emit("timerUpdate", room.timeLeft);

    // reveal letter every 30s
    if (room.timeLeft === 50 || room.timeLeft === 20) {
      room.hint = revealLetter(room.word, room.hint);
      ids.forEach((id) => {
        if (id !== drawerId)
          io.to(id).emit("showHint", { hint: room.hint });
      });
    }

    // timeout
    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      io.to(roomCode).emit("message", `⏰ Time’s up! The word was "${room.word}"`);
      setTimeout(() => rotateDrawer(roomCode), 1500);
    }
  }, 1000);
}

function rotateDrawer(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.drawerIndex++;
  if (room.drawerIndex >= Object.keys(room.players).length) {
    room.drawerIndex = 0; // loop back
  }
  startRound(roomCode);
}

function revealLetter(word, currentHint) {
  const w = word.split("");
  const h = currentHint.split(" ");
  const hidden = h.map((c, i) => (c === "_" ? i : null)).filter((x) => x !== null);
  if (hidden.length === 0) return currentHint;
  const random = hidden[Math.floor(Math.random() * hidden.length)];
  h[random] = w[random];
  return h.join(" ");
}

/* -------------------- SERVER START -------------------- */
const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
