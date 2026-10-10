// --- FIREBASE IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCMJj82WWXjy-CbSnq3s9osmXcaxEzLCGA",
  authDomain: "trivia-670d5.firebaseapp.com",
  databaseURL: "https://trivia-670d5-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "trivia-670d5",
  storageBucket: "trivia-670d5.firebasestorage.app",
  messagingSenderId: "497896532949",
  appId: "1:497896532949:web:2e3834ae4706c337d1eb5c",
  measurementId: "G-7293YR3V1W"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- THEME LOGIC ---
window.setTheme = function(theme) {
  const btnLight = document.getElementById('btn-light-theme');
  const btnDark = document.getElementById('btn-dark-theme');
  
  if (theme === 'dark') {
    document.body.style.backgroundColor = '#1a1a1a';
    document.body.style.color = '#f0f0f0';
    btnDark.style.border = '3px solid #fff';
    btnLight.style.border = '2px solid #cccccc';
  } else {
    document.body.style.backgroundColor = '#ffffff';
    document.body.style.color = '#000000';
    btnLight.style.border = '3px solid #333';
    btnDark.style.border = '2px solid #555555';
  }
};

// --- UI VARIABLES & BROWSER MEMORY ---
let chosenMode = "";
let chosenCategory = "";
let currentPlayerRole = ""; 

// MULTIPLAYER SYNC VARIABLES
let currentGameId = "";
let hasAnsweredThisRound = false;
let isShowingResults = false;

let myPlayerId = localStorage.getItem('trivia_player_id');
if (!myPlayerId) {
  myPlayerId = "player_" + Date.now();
  localStorage.setItem('trivia_player_id', myPlayerId); 
}

let myPlayerName = localStorage.getItem('trivia_player_name') || "";
const nameInput = document.getElementById('player-name-input');
if (nameInput) {
  nameInput.value = myPlayerName; 
}

window.savePlayerName = function(name) {
  myPlayerName = name.trim();
  localStorage.setItem('trivia_player_name', myPlayerName);
  
  const nameP1Display = document.getElementById('name-p1');
  const nameP2Display = document.getElementById('name-p2');
  
  if (nameP1Display && nameP2Display && currentPlayerRole !== "") {
    if (currentPlayerRole === "Player 1") {
        nameP1Display.textContent = (myPlayerName || "Player 1") + ":";
    } else {
        nameP2Display.textContent = (myPlayerName || "Player 2") + ":";
    }
  }
};

const modeSelector = document.getElementById('mode-selector');
const activeModeHeader = document.getElementById('active-mode-header');
const selectedModeDisplay = document.getElementById('selected-mode-display');
const categorySection = document.getElementById('category-section');
const waitingScreen = document.getElementById('waiting-screen');
const scoreboardContainer = document.getElementById('scoreboard-container');

// Elements for Results
const questionContainer = document.getElementById('question-container');
const resultsContainer = document.getElementById('results-container');
const finalResultsContainer = document.getElementById('final-results-container');

window.selectMode = function(modeName) {
  chosenMode = modeName;
  modeSelector.style.display = 'none';
  selectedModeDisplay.textContent = modeName;
  activeModeHeader.style.display = 'flex'; 
  categorySection.style.display = 'flex'; 
};

window.goBack = function() {
  categorySection.style.display = 'none';
  waitingScreen.style.display = 'none';
  activeModeHeader.style.display = 'none';
  modeSelector.style.display = 'flex';
};

// --- RECONNECT & MATCHMAKING LOGIC ---
window.selectCategory = async function(categoryName) {
  chosenCategory = categoryName;
  categorySection.style.display = 'none';

  let startingQuestion = 1; 
  let startingP1Score = 0;
  let startingP2Score = 0;
  let startingP1Streak = 0;
  let startingP2Streak = 0;
  let savedQuestionOrder = null;
  
  const savedGameStr = localStorage.getItem('active_trivia_game');
  if (savedGameStr) {
    const savedGame = JSON.parse(savedGameStr);
    
    if (savedGame.mode === chosenMode && savedGame.category === chosenCategory) {
      const wantToReconnect = confirm(`You left an unfinished game at Question ${savedGame.questionNum || 1}. Do you want to reconnect?`);
      
      if (wantToReconnect) {
        startingQuestion = savedGame.questionNum || 1; 
        startingP1Score = savedGame.p1Score || 0;
        startingP2Score = savedGame.p2Score || 0;
        startingP1Streak = savedGame.p1Streak || 0;
        startingP2Streak = savedGame.p2Streak || 0;
        savedQuestionOrder = savedGame.questionOrder; 
        
        startGame(savedGame.gameId, savedGame.role, startingQuestion, startingP1Score, startingP2Score, savedQuestionOrder, startingP1Streak, startingP2Streak);
        return; 
      } else {
        localStorage.removeItem('active_trivia_game');
      }
    }
  }

  waitingScreen.style.display = 'flex';
  
  if (!db) {
    alert("Firebase is not connected yet!");
    return;
  }
  
  const safeModeName = chosenMode.replace(/[^a-zA-Z0-9]/g, '');
  const safeCategoryName = chosenCategory.replace(/[^a-zA-Z0-9]/g, '');
  const queuePath = `queues/${safeModeName}/${safeCategoryName}`;
  const queueRef = ref(db, queuePath);
  
  const snapshot = await get(queueRef);
  
  if (snapshot.exists() && snapshot.val().playerId !== myPlayerId) {
    const gameId = "game_" + Date.now();
    await update(queueRef, { gameId: gameId });
    startGame(gameId, "Player 2", 1, 0, 0, null, 0, 0);
  } else {
    await set(queueRef, { playerId: myPlayerId });
    onValue(queueRef, (snap) => {
      const data = snap.val();
      if (data && data.gameId) {
        startGame(data.gameId, "Player 1", 1, 0, 0, null, 0, 0);
        remove(queueRef);
      }
    });
  }
};

// --- GAME START & TIMERS ---
const gameScreen = document.getElementById('game-screen');
const gameInfoDisplay = document.getElementById('game-info-display');
const boardContainer = document.getElementById('board-container');
const questionCounter = document.getElementById('question-counter');
const timerDisplay = document.getElementById('timer-display');

const correctAnswerDisplay = document.getElementById('correct-answer-display');
const scoreP1Display = document.getElementById('score-p1');
const scoreP2Display = document.getElementById('score-p2');
const streakDisplay = document.getElementById('streak-display');

let currentQuestionNum = 1;
const maxQuestions = 20;
let timerInterval;
let timeLeft = 15;

// Shared Pause Timer Variables
let nextQuestionInterval;
let nextQuestionTimeLeft = 3;
let isGamePaused = false;

let player1Score = 0;
let player2Score = 0;
let player1Streak = 0;
let player2Streak = 0;
let currentQuestions = []; 
let questionOrder = []; 

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function updateStreakDisplay() {
  const myStreak = currentPlayerRole === "Player 1" ? player1Streak : player2Streak;
  streakDisplay.textContent = myStreak;
}

async function startGame(gameId, playerRole, startingQuestion, p1Score, p2Score, savedOrder, p1Streak, p2Streak) {
  waitingScreen.style.display = 'none';
  activeModeHeader.style.display = 'none';
  
  const fileName = chosenCategory.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.json';
  try {
    const response = await fetch(`categories/${fileName}`);
    if (!response.ok) throw new Error("File not found");
    currentQuestions = await response.json();
  } catch (error) {
    alert("Questions for this category are not ready yet!");
    window.leaveGame();
    return;
  }
  
  currentPlayerRole = playerRole;
  currentGameId = gameId;

  if (currentPlayerRole === "Player 1") {
    if (savedOrder && savedOrder.length > 0) {
      questionOrder = savedOrder;
    } else {
      questionOrder = Array.from({length: currentQuestions.length}, (_, i) => i);
      shuffleArray(questionOrder);
    }
    
    // Player 1 creates the base game node in Firebase
    await update(ref(db, `games/${currentGameId}`), {
      questionOrder: questionOrder,
      currentQuestion: startingQuestion || 1,
      p1Answer: -2, 
      p2Answer: -2, 
      p1Gain: 0,
      p2Gain: 0,
      p1Score: p1Score || 0,
      p2Score: p2Score || 0,
      isPaused: false
    });
    
    finalizeGameStart(startingQuestion || 1, p1Score || 0, p2Score || 0, p1Streak || 0, p2Streak || 0);
  } else {
    if (savedOrder && savedOrder.length > 0) {
      questionOrder = savedOrder;
      finalizeGameStart(startingQuestion, p1Score, p2Score, p1Streak, p2Streak);
    } else {
      const gameRef = ref(db, `games/${currentGameId}`);
      const unsubscribe = onValue(gameRef, (snap) => {
        const data = snap.val();
        if (data && data.questionOrder) {
          questionOrder = data.questionOrder;
          unsubscribe(); 
          finalizeGameStart(data.currentQuestion, data.p1Score, data.p2Score, p1Streak, p2Streak);
        }
      });
    }
  }
}

function finalizeGameStart(startingQuestion, p1Score, p2Score, p1Streak, p2Streak) {
  currentQuestionNum = startingQuestion;
  player1Score = p1Score;
  player2Score = p2Score;
  player1Streak = p1Streak;
  player2Streak = p2Streak;
  hasAnsweredThisRound = false;
  isShowingResults = false;
  
  questionCounter.textContent = currentQuestionNum;
  scoreP1Display.textContent = player1Score;
  scoreP2Display.textContent = player2Score;
  updateStreakDisplay();
  gameInfoDisplay.textContent = `${chosenMode} - ${chosenCategory}`;
  
  const nameP1Display = document.getElementById('name-p1');
  const nameP2Display = document.getElementById('name-p2');
  if (currentPlayerRole === "Player 1") {
      nameP1Display.textContent = (myPlayerName || "Player 1") + ":";
      nameP2Display.textContent = "Player 2:";
  } else {
      nameP1Display.textContent = "Player 1:";
      nameP2Display.textContent = (myPlayerName || "Player 2") + ":";
  }
  
  if (chosenMode === 'Multiple Choice') {
    boardContainer.style.display = 'none';
  } else {
    boardContainer.style.display = 'flex';
  }
  
  gameScreen.style.display = 'flex';
  scoreboardContainer.style.display = 'flex'; 
  finalResultsContainer.style.display = 'none';
  
  // LIVE FIREBASE LISTENER
  onValue(ref(db, `games/${currentGameId}`), (snap) => {
    const data = snap.val();
    if (!data) return;

    // 1. Synchronized Pausing
    isGamePaused = data.isPaused || false;
    const pauseBtn = document.getElementById('pause-btn');
    const nextText = document.getElementById('next-question-text');
    
    if (isGamePaused) {
      clearInterval(nextQuestionInterval);
      if (pauseBtn) pauseBtn.textContent = "Resume Game";
      if (nextText) nextText.textContent = "Game Paused";
    } else {
      if (pauseBtn) pauseBtn.textContent = "Pause Game";
      if (isShowingResults && nextQuestionTimeLeft > 0) {
        if (nextText) nextText.innerHTML = `Next question in <span id="next-timer-display">${nextQuestionTimeLeft}</span> seconds...`;
        startNextQuestionCountdown();
      }
    }

    // 2. Transition to Results
    if (data.p1Answer !== -2 && data.p2Answer !== -2 && !isShowingResults && !data.gameOver) {
      isShowingResults = true;
      showMultiplayerResults(data);
    }

    // 3. Move to Next Question
    if (data.currentQuestion > currentQuestionNum && !data.gameOver) {
      currentQuestionNum = data.currentQuestion;
      isShowingResults = false;
      hasAnsweredThisRound = false;
      loadQuestionToUI();
      startTimer();
    }
    
    // 4. End Game
    if (data.gameOver) {
       clearInterval(timerInterval);
       clearInterval(nextQuestionInterval);
       showFinalResults();
    }
  });
  
  loadQuestionToUI();
  startTimer();
}

window.togglePause = function() {
  update(ref(db, `games/${currentGameId}`), { isPaused: !isGamePaused });
};

function startNextQuestionCountdown() {
  clearInterval(nextQuestionInterval);
  nextQuestionInterval = setInterval(() => {
    if (isGamePaused) return; 
    
    nextQuestionTimeLeft--;
    const nextTimerDisplay = document.getElementById('next-timer-display');
    if (nextTimerDisplay) nextTimerDisplay.textContent = nextQuestionTimeLeft;
    
    if (nextQuestionTimeLeft <= 0) {
      clearInterval(nextQuestionInterval);
      
      if (currentPlayerRole === "Player 1") {
         if (currentQuestionNum < maxQuestions) {
            update(ref(db, `games/${currentGameId}`), {
               currentQuestion: currentQuestionNum + 1,
               p1Answer: -2,
               p2Answer: -2,
               p1Gain: 0,
               p2Gain: 0,
               p1Score: player1Score,
               p2Score: player2Score
            });
         } else {
            // Signal Game Over!
            update(ref(db, `games/${currentGameId}`), { gameOver: true });
         }
      }
    }
  }, 1000);
}

function loadQuestionToUI() {
  const realIndex = questionOrder[currentQuestionNum - 1]; 
  const qData = currentQuestions[realIndex]; 
  
  document.getElementById('question-text').textContent = qData.question;
  
  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById('opt-'+i);
    btn.textContent = qData.options[i];
    btn.disabled = false;
    btn.style.opacity = '1';
  }
  
  questionCounter.textContent = currentQuestionNum;
  updateStreakDisplay();
  scoreP1Display.textContent = player1Score;
  scoreP2Display.textContent = player2Score;

  questionContainer.style.display = 'block';
  resultsContainer.style.display = 'none';
  finalResultsContainer.style.display = 'none';
  
  localStorage.setItem('active_trivia_game', JSON.stringify({
    gameId: currentGameId,
    mode: chosenMode,
    category: chosenCategory,
    role: currentPlayerRole,
    questionNum: currentQuestionNum,
    p1Score: player1Score,
    p2Score: player2Score,
    p1Streak: player1Streak,
    p2Streak: player2Streak,
    questionOrder: questionOrder
  }));
}

function startTimer() {
  clearInterval(timerInterval); 
  timeLeft = 15;
  timerDisplay.textContent = timeLeft;
  
  timerInterval = setInterval(() => {
    if (isGamePaused) return; 

    timeLeft--;
    timerDisplay.textContent = timeLeft;
    
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      
      if (!hasAnsweredThisRound) {
         window.submitAnswer(-1); 
      }
      
      // Peer-to-Peer Enforcer Logic
      get(ref(db, `games/${currentGameId}`)).then((snap) => {
         const data = snap.val();
         if (data && !data.gameOver) {
            const updateObj = {};
            if (currentPlayerRole === "Player 1" && data.p2Answer === -2) {
               updateObj.p2Answer = -1;
               updateObj.p2Gain = 0;
            } else if (currentPlayerRole === "Player 2" && data.p1Answer === -2) {
               updateObj.p1Answer = -1;
               updateObj.p1Gain = 0;
            }
            if (Object.keys(updateObj).length > 0) {
               update(ref(db, `games/${currentGameId}`), updateObj);
            }
         }
      });
      
    }
  }, 1000); 
}

// --- RESULTS LOGIC ---
window.submitAnswer = function(optionIndex) {
  if (hasAnsweredThisRound || isShowingResults) return;
  hasAnsweredThisRound = true;

  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById('opt-'+i);
    btn.disabled = true;
    if (i !== optionIndex && optionIndex !== -1) {
       btn.style.opacity = '0.4';
    }
  }
  document.getElementById('question-text').textContent = "Waiting for opponent...";

  const realIndex = questionOrder[currentQuestionNum - 1]; 
  const qData = currentQuestions[realIndex];
  
  let speedMultiplier = 1 + ((timeLeft * 2) / 100); 
  let currentStreak = (currentPlayerRole === "Player 1") ? player1Streak : player2Streak;
  const basePoints = 1000 + (currentStreak * 100);
  let pointsGained = 0;

  if (optionIndex === qData.answerIndex) {
     pointsGained = Math.floor(basePoints * speedMultiplier);
  }

  const updateObj = {};
  if (currentPlayerRole === "Player 1") {
     updateObj.p1Answer = optionIndex;
     updateObj.p1Gain = pointsGained;
  } else {
     updateObj.p2Answer = optionIndex;
     updateObj.p2Gain = pointsGained;
  }
  update(ref(db, `games/${currentGameId}`), updateObj);
};

function showMultiplayerResults(data) {
  clearInterval(timerInterval);
  
  const realIndex = questionOrder[currentQuestionNum - 1]; 
  const qData = currentQuestions[realIndex];
  const correctIndex = qData.answerIndex;
  
  let p1Gain = data.p1Gain || 0;
  let p2Gain = data.p2Gain || 0;

  player1Score += p1Gain;
  player2Score += p2Gain;

  if (data.p1Answer === correctIndex) player1Streak++; else player1Streak = 0;
  if (data.p2Answer === correctIndex) player2Streak++; else player2Streak = 0;
  
  const nameP1Str = document.getElementById('name-p1').textContent.replace(':', '');
  const nameP2Str = document.getElementById('name-p2').textContent.replace(':', '');
  document.getElementById('p1-name-result').textContent = nameP1Str;
  document.getElementById('p2-name-result').textContent = nameP2Str;
  
  document.getElementById('p1-points-result').textContent = (data.p1Answer === correctIndex) ? `+${p1Gain}` : ((data.p1Answer === -1) ? "Time's Up" : "Incorrect");
  document.getElementById('p1-points-result').style.color = (data.p1Answer === correctIndex) ? "#fff" : "#ff5252";
  
  document.getElementById('p2-points-result').textContent = (data.p2Answer === correctIndex) ? `+${p2Gain}` : ((data.p2Answer === -1) ? "Time's Up" : "Incorrect");
  document.getElementById('p2-points-result').style.color = (data.p2Answer === correctIndex) ? "#fff" : "#ff5252";

  const p1Row = document.getElementById('p1-result-row');
  const p2Row = document.getElementById('p2-result-row');
  if (p2Gain > p1Gain) {
    p1Row.style.order = "2";
    p2Row.style.order = "1";
  } else {
    p1Row.style.order = "1";
    p2Row.style.order = "2";
  }
  
  scoreP1Display.textContent = player1Score;
  scoreP2Display.textContent = player2Score;
  updateStreakDisplay();
  correctAnswerDisplay.textContent = qData.options[correctIndex];
  
  questionContainer.style.display = 'none';
  resultsContainer.style.display = 'block';

  const savedGameStr = localStorage.getItem('active_trivia_game');
  if (savedGameStr) {
    const savedGame = JSON.parse(savedGameStr);
    savedGame.p1Score = player1Score;
    savedGame.p2Score = player2Score;
    savedGame.p1Streak = player1Streak;
    savedGame.p2Streak = player2Streak;
    localStorage.setItem('active_trivia_game', JSON.stringify(savedGame));
  }
  
  nextQuestionTimeLeft = 3;
  document.getElementById('next-question-text').innerHTML = `Next question in <span id="next-timer-display">3</span> seconds...`;
  
  if (!isGamePaused) {
    startNextQuestionCountdown();
  } else {
    document.getElementById('next-question-text').textContent = "Game Paused";
  }
}

function showFinalResults() {
  questionContainer.style.display = 'none';
  resultsContainer.style.display = 'none';

  const winnerTitle = document.getElementById('final-winner-title');
  const nameP1Str = document.getElementById('name-p1').textContent.replace(':', '');
  const nameP2Str = document.getElementById('name-p2').textContent.replace(':', '');

  document.getElementById('final-p1-name').textContent = nameP1Str;
  document.getElementById('final-p2-name').textContent = nameP2Str;
  document.getElementById('final-p1-score').textContent = player1Score;
  document.getElementById('final-p2-score').textContent = player2Score;

  if (player1Score > player2Score) {
    winnerTitle.textContent = nameP1Str + " Wins!";
    winnerTitle.style.color = "#4caf50"; 
  } else if (player2Score > player1Score) {
    winnerTitle.textContent = nameP2Str + " Wins!";
    winnerTitle.style.color = "#2196f3"; 
  } else {
    winnerTitle.textContent = "It's a Tie!";
    winnerTitle.style.color = "#ffeb3b"; 
  }

  finalResultsContainer.style.display = 'block';
  localStorage.removeItem('active_trivia_game');
}

window.leaveGame = function() {
  clearInterval(timerInterval);
  clearInterval(nextQuestionInterval);
  currentPlayerRole = ""; 
  hasAnsweredThisRound = false;
  isShowingResults = false;
  gameScreen.style.display = 'none';
  scoreboardContainer.style.display = 'none';
  finalResultsContainer.style.display = 'none';
  modeSelector.style.display = 'flex';
};