const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

/* -------------------- DATA -------------------- */
const rooms = {};
const words = [
  "banana", "hotdog", "sausage", "pickle", "melons", "peaches", "eggplant",
  "donut", "taco", "bun", "muffin", "cream", "popsicle", "burrito",
  "sandwich", "nacho", "cookie", "lollipop", "kiss", "bed", "shower",
  "undies", "bra", "boxer", "heels", "lipstick", "selfie", "wink", "bikini",
  "blush", "pillow", "mirror", "perfume", "handcuffs", "blanket", "candle",
  "chocolate", "whip", "massage", "belly", "tongue", "beard", "eyebrow",
  "icecube", "lotion", "towel", "pajamas", "diary", "poop", "fart", "toilet",
  "underwear", "hairbrush", "sneeze", "pussycat", "rooster", "monkey",
  "donkey", "duck", "cow", "pig", "disco", "wine", "shot", "champagne",
  "cocktail", "straw", "couch", "belt", "tie", "boots", "necklace",
  "sunglasses", "wet", "hot", "sticky", "sweaty", "juicy", "spicy", "rough",
  "smooth", "clown", "slipper", "remote", "balloon", "soap", "bathtub",
  "rubberduck", "bubbles", "steam", "sponge", "naughty", "secret", "spy",
  "kissmark", "whisper", "dare", "truth", "flirt", "filter", "emoji",
  "hashtag", "like", "meme", "honey", "sugar", "candy", "icecream",
  "milkshake", "date", "rose", "heart", "cupid", "valentine", "couple",
  "hug", "wink", "lick", "bite", "chase", "drool", "sock", "wig", "sweat",
  "dance", "twerk", "karaoke", "pizza", "toast", "popcorn", "burger", "fries",
  "onion", "cheese", "potato", "chips", "marshmallow", "coffee", "beer",
  "milk", "fork", "spoon", "knife", "lunchbox", "basket", "lipgloss",
  "bracelet", "watch", "charger", "laptop", "keyboard", "backpack", "wallet",
  "ribbon", "confetti", "cake", "candle", "guitar", "drum", "violin", "piano",
  "microphone", "speaker", "heartbeat", "devil", "fire", "moon", "star",
  "rocket", "alien", "mermaid", "unicorn", "dragon", "genie", "witch",
  "vampire", "ghost", "angel", "halo", "seduce", "cuddle", "tickle", "jump",
  "slide", "spin", "peek", "snap", "stretch", "pose", "laugh", "sleep",
  "dream", "run", "fly", "swim", "surf", "climb", "fall", "grab", "tug",
  "poke", "tap", "kick", "slap", "snore", "sweat", "rain", "storm", "beach",
  "forest", "mountain", "valley", "island", "key", "lock", "door", "window",
  "curtain", "fan", "light", "battery", "knife", "pen", "pencil", "paper",
  "book", "map", "bag", "bottle", "clock", "speaker", "stage", "shadow",
  "moonlight", "heart"
];
const colors = ["#ef4444", "#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"];

function genRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

/* -------------------- SOCKET HANDLERS -------------------- */
io.on("connection", (socket) => {
  socket.data.roomCode = null;
  socket.data.name = null;

  /* ========== CREATE ROOM ========== */
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

  /* ========== JOIN ROOM ========== */
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

  /* ========== START GAME ========== */
  socket.on("startGame", () => {
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    if (!room || socket.id !== room.host) return;
    if (room.gameActive) return;

    room.gameActive = true;
    room.drawerIndex = 0;
    startRound(roomCode);
  });

  /* ========== DRAW EVENTS ========== */
  socket.on("startDrawing", (data) => forwardIfDrawer(socket, "startDrawing", data));
  socket.on("drawing", (data) => forwardIfDrawer(socket, "drawing", data));
  socket.on("stopDrawing", (data) => forwardIfDrawer(socket, "stopDrawing", data));
  socket.on("clearCanvas", (data) => forwardIfDrawer(socket, "clearCanvas", data));

  function forwardIfDrawer(socket, event, data) {
    const room = rooms[socket.data.roomCode];
    if (!room || socket.id !== room.drawer) return;
    socket.to(socket.data.roomCode).emit(event, data);
  }

  /* ========== GUESSING ========== */
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
      room.timer = null;

      setTimeout(() => rotateDrawer(roomCode), 1500);
    } else {
      io.to(roomCode).emit("message", `${name}: ${guess}`);
    }
  });

  /* ========== DISCONNECT ========== */
  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];

    delete room.players[socket.id];
    io.to(roomCode).emit("playerList", Object.values(room.players));

    if (Object.keys(room.players).length < 2) {
      clearInterval(room.timer);
      room.gameActive = false;
      io.to(roomCode).emit("message", "⚠️ Not enough players — game paused.");
      return;
    }

    if (socket.id === room.drawer) {
      clearInterval(room.timer);
      room.timer = null;
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

  // Select next drawer
  const drawerId = ids[room.drawerIndex % ids.length];
  room.drawer = drawerId;
  const drawerName = room.players[drawerId].name;

  // Pick word + setup
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

    // Reveal letters every 30s
    if (room.timeLeft === 50 || room.timeLeft === 20) {
      room.hint = revealLetter(room.word, room.hint);
      ids.forEach((id) => {
        if (id !== drawerId)
          io.to(id).emit("showHint", { hint: room.hint });
      });
    }

    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      room.timer = null;
      io.to(roomCode).emit("message", `⏰ Time’s up! The word was "${room.word}"`);
      setTimeout(() => rotateDrawer(roomCode), 1500);
    }
  }, 1000);
}

function rotateDrawer(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const ids = Object.keys(room.players);
  if (ids.length < 2) {
    io.to(roomCode).emit("message", "⚠️ Not enough players to continue!");
    room.gameActive = false;
    return;
  }

  room.drawerIndex = (room.drawerIndex + 1) % ids.length;
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
