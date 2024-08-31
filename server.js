const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const questions = require('./questions.json');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "https://teacher-site.vercel.app/",
    methods: ["GET", "POST"]
  }
});

const games = {};

io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('createGame', (playerName) => {
    const gameCode = uuidv4().substr(0, 6);
    games[gameCode] = {
      players: [{id: socket.id, name: playerName, score: 0}],
      currentPlayerIndex: 0,
      currentQuestionIndex: 0,
      state: 'waiting',
      timer: null
    };
    socket.join(gameCode);
    socket.emit('gameCode', gameCode);
    io.to(gameCode).emit('gameState', 'waiting');
    io.to(gameCode).emit('playerList', games[gameCode].players);
  });

  socket.on('joinGame', ({gameCode, playerName}) => {
    if (games[gameCode] && games[gameCode].state === 'waiting') {
      games[gameCode].players.push({id: socket.id, name: playerName, score: 0});
      socket.join(gameCode);
      socket.emit('gameCode', gameCode);
      io.to(gameCode).emit('gameState', 'waiting');
      io.to(gameCode).emit('playerList', games[gameCode].players);
    } else {
      socket.emit('error', 'Game not found or already started');
    }
  });

  socket.on('startGame', () => {
    const game = Object.values(games).find(g => g.players.some(p => p.id === socket.id));
    if (game) {
      game.state = 'playing';
      const gameCode = Object.keys(games).find(key => games[key] === game);
      io.to(gameCode).emit('gameState', 'playing');
      nextQuestion(gameCode);
    }
  });

  socket.on('answer', (answerIndex) => {
    const gameCode = Object.keys(games).find(key => games[key].players.some(p => p.id === socket.id));
    const game = games[gameCode];
    if (game && game.state === 'playing' && game.players[game.currentPlayerIndex].id === socket.id) {
      clearTimeout(game.timer);
      const currentQuestion = questions[game.currentQuestionIndex];
      if (answerIndex === currentQuestion.correctAnswer) {
        game.players[game.currentPlayerIndex].score++;
      }
      io.to(gameCode).emit('playerList', game.players);
      nextQuestion(gameCode);
    }
  });

  socket.on('leaveGame', () => {
    const gameCode = Object.keys(games).find(key => games[key].players.some(p => p.id === socket.id));
    if (gameCode) {
      leaveGame(socket, gameCode);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    const gameCode = Object.keys(games).find(key => games[key].players.some(p => p.id === socket.id));
    if (gameCode) {
      leaveGame(socket, gameCode);
    }
  });
});

function leaveGame(socket, gameCode) {
  const game = games[gameCode];
  game.players = game.players.filter(p => p.id !== socket.id);
  socket.leave(gameCode);
  
  if (game.players.length === 0) {
    clearTimeout(game.timer);
    delete games[gameCode];
  } else {
    io.to(gameCode).emit('playerList', game.players);
    if (game.state === 'playing' && game.players[game.currentPlayerIndex].id === socket.id) {
      nextQuestion(gameCode);
    }
  }
}

function nextQuestion(gameCode) {
  const game = games[gameCode];
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
  game.currentQuestionIndex++;
  
  if (game.currentQuestionIndex >= questions.length) {
    endGame(gameCode);
  } else {
    const currentQuestion = questions[game.currentQuestionIndex];
    const questionUpdate = {
      question: {
        text: currentQuestion.question,
        answers: currentQuestion.answers
      },
      currentPlayer: game.players[game.currentPlayerIndex],
      timeLeft: 10
    };
    io.to(gameCode).emit('questionUpdate', questionUpdate);
    startTimer(gameCode);
  }
}

function startTimer(gameCode) {
  const game = games[gameCode];
  clearTimeout(game.timer);
  game.timer = setTimeout(() => {
    nextQuestion(gameCode);
  }, 10000);
}

function endGame(gameCode) {
  const game = games[gameCode];
  game.state = 'finished';
  io.to(gameCode).emit('gameState', 'finished');
  clearTimeout(game.timer);
  delete games[gameCode];
}

const port = 3001;
server.listen(port, () => console.log(`Server running on port ${port}`));