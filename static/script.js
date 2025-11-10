// Переменные
let socket, playerId = null, sessionToken = null, username = '';
let tg = window.Telegram.WebApp;
let userData = {};
let tonConnectUI;
let currentCaseType = null;
let currentCasePrice = 0;
let isSpinning = false;
let spinInterval = null;
let reelItems = [];
let currentInventory = [];
let playerHasBet = false;

// Инициализация
tg.expand();
tg.enableClosingConfirmation();

// Функции
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function updateArrow(mult) {
    const x = Math.min(700, mult * 70);
    const y = Math.max(30, 341 - mult * 45);
    const arrowLine = document.getElementById('arrow-line');
    const arrowFill = document.getElementById('arrow-fill');
    if (arrowLine && arrowFill) {
        arrowLine.setAttribute("d", `M 0 341 Q ${x/2} 341 ${x} ${y}`);
        arrowFill.setAttribute("d", `M 0 341 Q ${x/2} 341 ${x} ${y} L ${x} 341 Z`);
    }
}

function updateBalance(balance) {
    const roundedBalance = Math.round(balance * 100) / 100;
    const balanceElement = document.getElementById('balance');
    balanceElement.textContent = roundedBalance.toFixed(2);
    userData.balance = roundedBalance;
}

// Отображение активных игроков
function renderActivePlayers(players) {
    const container = document.getElementById('active-bets-list');
    if (!container) return;
    
    if (!players || players.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 8px; font-size: 0.85rem;">Нет активных ставок</div>';
        return;
    }
    
    container.innerHTML = '';
    players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'active-bet-item';
        playerDiv.innerHTML = `
            <span class="active-bet-name">${player.name}</span>
            <span class="active-bet-amount">
                <img src="https://ton.org/download/ton_symbol.png" alt="TON" style="width: 12px; height: 12px;">
                ${player.bet.toFixed(2)}
                ${player.cashed_out ? `<span style="color: #10b981; margin-left: 8px;">✓ ${player.multiplier.toFixed(2)}x</span>` : ''}
            </span>
        `;
        container.appendChild(playerDiv);
    });
}

function updateProfileData() {
    document.getElementById('profile-name').textContent = username || 'Игрок';
    document.getElementById('profile-id').textContent = `ID: ${userData.telegram_id?.slice(-8) || '---'}`;
    document.getElementById('total-games').textContent = userData.total_games || 0;
    document.getElementById('total-wins').textContent = userData.total_wins || 0;
    document.getElementById('best-multiplier').textContent = (userData.best_multiplier || 1.0).toFixed(1) + 'x';
}

function updateUserLevel() {
    const games = userData.total_games || 0;
    let levelName = 'Новичок';

    if (games >= 100) levelName = 'Мастер';
    else if (games >= 50) levelName = 'Эксперт';
    else if (games >= 20) levelName = 'Опытный';
    else if (games >= 10) levelName = 'Любитель';

    document.getElementById('user-level-name').textContent = levelName;
}

// Socket.IO подключение
function connectSocket() {
    const socketUrl = window.location.origin;
    socket = io(socketUrl, {
        transports: ['polling', 'websocket'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000
    });

    socket.on("connect", () => {
        console.log("Подключено к серверу");
        autoLogin();
    });

    socket.on("message", (data) => handleMessage(data));

    socket.on("disconnect", () => {
        console.log("Отключено от сервера");
        showToast("Соединение потеряно", "error");
    });

    socket.on("connect_error", (error) => {
        console.error("Ошибка подключения:", error);
    });
}

function autoLogin() {
    sessionToken = localStorage.getItem('session_token');
    username = localStorage.getItem('username');
    const telegramId = localStorage.getItem('telegram_id');

    if (sessionToken && username && telegramId && socket?.connected) {
        socket.emit("message", {
            action: 'session_login',
            session_token: sessionToken,
            telegram_id: telegramId
        });
    }
}

function handleTelegramAuth(authData) {
    if (!authData || !authData.user) {
        showToast('Ошибка авторизации', 'error');
        return;
    }

    if (socket?.connected) {
        socket.emit("message", {
            action: "telegram_login",
            auth_data: authData
        });
    } else {
        showToast('Нет подключения к серверу', 'error');
    }
}

function handleMessage(msg) {
    if (!msg) return;
    console.log("Получено сообщение:", msg);

    if (msg.type === "telegram_login_result" || msg.type === "session_login_result") {
        if (msg.result?.success) {
            playerId = msg.result.player_id;
            sessionToken = msg.result.session_token;
            username = msg.result.user_data.name;
            userData = msg.result.user_data;

            localStorage.setItem('session_token', sessionToken);
            localStorage.setItem('username', username);
            localStorage.setItem('telegram_id', userData.telegram_id);

            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');
            updateBalance(userData.balance);

            updateUserLevel();
            showToast(`Привет, ${username}!`, 'success');
        } else {
            showToast(msg.result?.message || 'Ошибка входа', 'error');
        }
    }
    else if (msg.type === "player_registered") {
        playerId = msg.player_id;
        if (msg.history) {
            displayHistory(msg.history);
        }
    }
    else if (msg.type === "game_state") {
        if (msg.data) {
            const state = msg.data.state;
            const multiplier = msg.data.multiplier || 1.0;
            const countdown = msg.data.countdown || 15;

            document.getElementById('current-multiplier').textContent = `${multiplier.toFixed(2)}x`;
            document.getElementById('countdown-timer').textContent = `${countdown}s`;

            const statusMap = {
                'waiting': 'Ожидание',
                'starting': 'Старт',
                'flying': '🚀 Полёт',
                'crashed': '💥 Краш'
            };
            document.getElementById('game-status-text').textContent = statusMap[state] || 'Ожидание';

            const placeBetBtn = document.getElementById('place-bet');
            const cashoutBtn = document.getElementById('cashout');

            if (state === 'waiting' || state === 'starting') {
                placeBetBtn.disabled = false;
                if (!playerHasBet) {
                    cashoutBtn.disabled = true;
                }
            } else if (state === 'flying') {
                placeBetBtn.disabled = true;
                if (playerHasBet) {
                    cashoutBtn.disabled = false;
                }
            } else if (state === 'crashed') {
                cashoutBtn.disabled = true;
                playerHasBet = false;
            }

            updateArrow(multiplier);
            
            // Обновляем онлайн счетчик
            if (msg.online_count !== undefined) {
                document.getElementById('online-count').textContent = msg.online_count;
            }
            
            // Обновляем список активных игроков
            if (msg.active_players !== undefined) {
                console.log('Активные игроки:', msg.active_players.length, msg.active_players);
                renderActivePlayers(msg.active_players);
                document.getElementById('players-count').innerHTML = `<i class="fas fa-users"></i><span>${msg.active_players.length}</span>`;
            }
        }
    }
    else if (msg.type === "bet_result") {
        if (msg.result?.success) {
            updateBalance(msg.result.balance);
            playerHasBet = true;
            document.getElementById('cashout').disabled = false;
            showToast('Ставка принята!', 'success');
        } else {
            showToast(msg.result?.message || 'Ошибка ставки', 'error');
        }
    }
    else if (msg.type === "cashout_result") {
        if (msg.result?.success) {
            updateBalance(msg.result.balance);
            document.getElementById('cashout').disabled = true;
            playerHasBet = false;
            showToast(`+${msg.result.win_amount.toFixed(2)} TON на ${msg.result.multiplier.toFixed(2)}x!`, 'success');
        } else {
            showToast(msg.result?.message || 'Ошибка', 'error');
        }
    }
    else if (msg.type === "game_history") {
        if (msg.history) {
            displayHistory(msg.history);
        }
    }
    else if (msg.type === "wallet_connect_result") {
        if (msg.result?.success) {
            const addr = msg.result.wallet_address;
            document.getElementById('wallet-status-text').textContent = `${addr.slice(0,6)}...${addr.slice(-6)}`;
            showToast('Кошелек подключен!', 'success');
        } else {
            showToast(msg.result?.message || 'Ошибка подключения', 'error');
        }
    }
    else if (msg.type === "case_open_result") {
        if (msg.result?.success) {
            updateBalance(msg.result.balance);

            const prize = msg.result.prize;
            const reelItemsList = msg.result.reel_items || [];
            const prizeIndex = msg.result.prize_index || 5;

            reelItems = reelItemsList;
            
            // Запускаем анимацию
            startReelAnimation(reelItemsList, prizeIndex, prize, msg.result.case_price);

            // Обновляем статистику
            userData.total_games = (userData.total_games || 0) + 1;
            if (prize.value > currentCasePrice) {
                userData.total_wins = (userData.total_wins || 0) + 1;
            }
            updateUserLevel();

            console.log('Кейс успешно открыт! Приз:', prize.value, 'TON -', prize.name, 'Индекс:', prizeIndex);
        } else {
            showToast(msg.result?.message || 'Ошибка открытия кейса', 'error');
            isSpinning = false;
            document.getElementById('btn-spin').disabled = false;
            if (spinInterval) {
                clearInterval(spinInterval);
                spinInterval = null;
            }
            if (spinSoundInterval) {
                clearInterval(spinSoundInterval);
                spinSoundInterval = null;
            }
        }
    }
    else if (msg.type === "inventory_result") {
        if (msg.result?.success) {
            currentInventory = msg.result.items || [];
            renderInventory();
        } else {
            showToast(msg.result?.message || 'Ошибка загрузки инвентаря', 'error');
        }
    }
    else if (msg.type === "sell_item_result") {
        if (msg.result?.success) {
            updateBalance(msg.result.balance);
            showToast(`Продано за ${msg.result.sold_value.toFixed(2)} TON`, 'success');
            loadInventory();
        } else {
            showToast(msg.result?.message || 'Ошибка продажи', 'error');
        }
    }
    else if (msg.type === "sell_all_result") {
        if (msg.result?.success) {
            updateBalance(msg.result.balance);
            showToast(`Всё продано за ${msg.result.sold_value.toFixed(2)} TON`, 'success');
            loadInventory();
        } else {
            showToast(msg.result?.message || 'Ошибка', 'error');
        }
    }
    else if (msg.type === "case_items_result") {
        if (msg.result?.success) {
            renderCaseItems(msg.result.items || []);
            // Обновляем изображение кейса в модальном окне, если есть
            if (msg.result.case_image) {
                updateCaseImageInModal(msg.result.case_image);
            }
        } else {
            document.getElementById('case-items-grid').innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">Ошибка загрузки предметов</div>';
        }
    }
    else if (msg.type === "error") {
        showToast(msg.message || 'Ошибка сервера', 'error');
    }
}

function displayHistory(history) {
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';

    if (!history || history.length === 0) {
        historyList.innerHTML = '<div style="text-align:center;color:#666;padding:20px;">История пуста</div>';
        return;
    }

    history.forEach(entry => {
        const mult = entry.multiplier || entry;
        const badge = document.createElement('div');
        badge.className = `history-badge ${mult >= 2 ? 'win' : 'lose'}`;
        badge.textContent = `${mult.toFixed(2)}x`;
        historyList.appendChild(badge);
    });
}

// Отрисовка барабана с дублированием для бесконечной прокрутки
function renderReel(items) {
    const reel = document.getElementById('spinning-reel');
    if (!reel) return;
    
    reel.innerHTML = '';

    // Дублируем элементы 3 раза для бесконечной прокрутки
    const duplicatedItems = [...items, ...items, ...items];
    
    console.log('Рендерим', duplicatedItems.length, 'элементов');

    duplicatedItems.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'reel-item';
        
        const itemIcon = getItemIcon(item.value || 0);
        const itemName = item.name || 'Item';
        const itemValue = item.value || 0;
        
        // Создаем структуру с иконкой по умолчанию
        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'reel-item-icon-wrapper';
        
        const iconDiv = document.createElement('div');
        iconDiv.className = 'reel-item-icon';
        iconDiv.textContent = itemIcon;
        iconDiv.style.display = 'flex';
        
        // Если есть изображение, пытаемся загрузить его
        if (item.image) {
            const img = document.createElement('img');
            img.src = item.image;
            img.alt = itemName;
            img.className = 'reel-item-image';
            img.style.display = 'none';
            
            img.onload = function() {
                img.style.display = 'block';
                iconDiv.style.display = 'none';
            };
            
            img.onerror = function() {
                img.style.display = 'none';
                iconDiv.style.display = 'flex';
            };
            
            iconWrapper.appendChild(img);
        }
        
        iconWrapper.appendChild(iconDiv);
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'reel-item-name';
        nameDiv.textContent = itemName;
        
        const valueDiv = document.createElement('div');
        valueDiv.className = 'reel-item-value';
        const tonIcon = document.createElement('img');
        tonIcon.src = 'https://ton.org/download/ton_symbol.png';
        tonIcon.alt = 'TON';
        tonIcon.style.width = '10px';
        tonIcon.style.height = '10px';
        valueDiv.appendChild(tonIcon);
        valueDiv.appendChild(document.createTextNode(' ' + itemValue.toFixed(2)));
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'reel-item-content';
        contentDiv.appendChild(iconWrapper);
        contentDiv.appendChild(nameDiv);
        contentDiv.appendChild(valueDiv);
        
        itemDiv.appendChild(contentDiv);
        reel.appendChild(itemDiv);
    });
}

// Открытие модального окна кейса
function openCaseModal(caseType, price) {
    currentCaseType = caseType;
    currentCasePrice = price;
    isSpinning = false;

    const names = {
        'starter': 'Starter Case',
        'premium': 'Premium Case',
        'gold': 'Gold Case',
        'jackpot': 'Jackpot Case',
        'mega': 'Mega Case',
        'ultimate': 'Ultimate Case'
    };

    document.getElementById('modal-case-name').textContent = names[caseType] || 'Case';
    document.getElementById('modal-case-price').textContent = price;
    document.getElementById('modal-user-balance').textContent = (Math.round(userData.balance * 100) / 100).toFixed(2);

    // Сбрасываем позицию барабана
    const reel = document.getElementById('spinning-reel');
    if (!reel) {
        showToast('Ошибка загрузки интерфейса', 'error');
        return;
    }
    
    reel.style.transform = 'translateX(0)';
    reel.style.transition = 'none';
    reel.innerHTML = '';

    // Загружаем список возможных предметов из кейса
    loadCaseItems(caseType);

    document.getElementById('case-modal').classList.remove('hidden');
    document.getElementById('btn-spin').disabled = false;
}

// Загрузка списка предметов из кейса
function loadCaseItems(caseType) {
    if (socket?.connected && playerId) {
        // Показываем загрузку
        document.getElementById('case-items-grid').innerHTML = '<div class="loader-small"><div class="spinner-small"></div><div>Загрузка...</div></div>';
        
        socket.emit("message", {
            action: "get_case_items",
            player_id: playerId,
            case_type: caseType
        });
    }
}

// Отображение предметов из кейса
function renderCaseItems(items) {
    const grid = document.getElementById('case-items-grid');
    
    if (!items || items.length === 0) {
        grid.innerHTML = '<div style="color: #666; text-align: center; padding: 20px;">Предметы не найдены</div>';
        return;
    }

    grid.innerHTML = '';
    
    items.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'case-item-preview';
        
        // Вычисляем процент вероятности (chance уже задан как процент от 100)
        const percentage = item.chance ? item.chance.toFixed(0) + '%' : '0%';
        
        // Определяем цвет в зависимости от редкости (на основе значения)
        let rarityClass = 'common';
        const itemValue = item.value || 1;
        
        // Определяем редкость строго на основе значения предмета
        if (itemValue >= 100) rarityClass = 'mythic';
        else if (itemValue >= 50) rarityClass = 'legendary';
        else if (itemValue >= 10) rarityClass = 'epic';
        else if (itemValue >= 5) rarityClass = 'rare';
        else if (itemValue >= 2) rarityClass = 'uncommon';
        else rarityClass = 'common';
        
        itemDiv.innerHTML = `
            <div class="case-item-preview-image ${rarityClass}">
                ${item.image ? `<img src="${item.image}" alt="${item.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />` : ''}
                <div class="case-item-preview-fallback" style="${item.image ? 'display: none;' : ''}">${getItemIcon(item.value)}</div>
            </div>
            <div class="case-item-preview-name">${item.name}</div>
            <div class="case-item-preview-value">
                <img src="https://ton.org/download/ton_symbol.png" alt="TON" style="width: 12px; height: 12px; filter: drop-shadow(0 1px 2px rgba(99, 102, 241, 0.4));">
                ${item.value}
            </div>
            <div class="case-item-preview-chance">${percentage}%</div>
        `;
        
        grid.appendChild(itemDiv);
    });
}

// Получить иконку по значению предмета
function getItemIcon(value) {
    if (value >= 100) return '👑';
    if (value >= 50) return '💎';
    if (value >= 10) return '⭐';
    if (value >= 5) return '🎁';
    if (value >= 2) return '💰';
    return '📦';
}

// Обновить изображение кейса в модальном окне
function updateCaseImageInModal(caseImagePath) {
    // Можно использовать для отображения изображения кейса в модальном окне
    // Пока оставляем как есть
}

// Закрытие модального окна кейса
function closeCaseModal() {
    // НЕЛЬЗЯ закрыть во время прокрутки!
    if (isSpinning) {
        showToast('Подождите окончания прокрутки', 'error');
        return;
    }
    
    // Останавливаем все анимации и звуки
    if (spinInterval) {
        clearInterval(spinInterval);
        spinInterval = null;
    }
    if (spinSoundInterval) {
        clearInterval(spinSoundInterval);
        spinSoundInterval = null;
    }
    
    isSpinning = false;
    document.getElementById('btn-spin').disabled = false;
    document.getElementById('case-modal').classList.add('hidden');
    
    // Очищаем барабан
    const reel = document.getElementById('spinning-reel');
    if (reel) {
        reel.style.transition = 'none';
        reel.style.transform = 'translateX(0)';
        reel.innerHTML = '';
    }
}

// Запуск вращения
async function startSpin() {
    if (isSpinning) return;

    if (userData.balance < currentCasePrice) {
        showToast(`Недостаточно средств. Нужно ${currentCasePrice} TON`, 'error');
        return;
    }

    if (!socket?.connected || !playerId) {
        showToast('Нет подключения к серверу', 'error');
        return;
    }

    isSpinning = true;
    // Блокируем кнопку открытия
    document.getElementById('btn-spin').disabled = true;

    // Звук открытия
    try {
        playSound('open');
    } catch(e) {}

    // Отправляем запрос на сервер
    socket.emit("message", {
        action: "open_case",
        player_id: playerId,
        case_type: currentCaseType,
        price: currentCasePrice
    });
}

// Медленная прокрутка, МИНИМАЛЬНАЯ дистанция
function startReelAnimation(items, prizeIndex = 50, prize, casePrice) {
    if (!items || items.length === 0) {
        isSpinning = false;
        document.getElementById('btn-spin').disabled = false;
        return;
    }
    
    renderReel(items);

    const reel = document.getElementById('spinning-reel');
    if (!reel) {
        isSpinning = false;
        document.getElementById('btn-spin').disabled = false;
        return;
    }
    
    console.log('Приз:', prize.value);
    
    let currentPos = 0;
    let speed = 35; // Чуть быстрее
    const itemWidth = 120;
    // МИНИМАЛЬНАЯ дистанция - всего 10 элементов до приза!
    const targetPos = (10 + prizeIndex) * itemWidth;
    
    // Сброс позиции
    reel.style.transition = 'none';
    reel.style.transform = 'translateX(0px)';
    
    // Приятный звук
    if (spinSoundInterval) clearInterval(spinSoundInterval);
    spinSoundInterval = setInterval(() => {
        try {
            playSound('spin');
        } catch(e) {}
    }, 90);

    // Быстрая анимация
    if (spinInterval) clearInterval(spinInterval);
    spinInterval = setInterval(() => {
        currentPos += speed;
        reel.style.transform = `translateX(${-currentPos}px)`;

        // Быстрое замедление
        if (currentPos > targetPos - 300) {
            speed = Math.max(4, speed * 0.92);
        }
        
        // Остановка
        if (currentPos >= targetPos && speed <= 6) {
            clearInterval(spinInterval);
            clearInterval(spinSoundInterval);
            stopSpinWithResult(prize, casePrice, 10 + prizeIndex);
        }
    }, 25);
}

// Мгновенная остановка с правильным призом
function stopSpinWithResult(prize, casePrice, finalPrizeIndex) {
    clearInterval(spinInterval);
    clearInterval(spinSoundInterval);

    const reel = document.getElementById('spinning-reel');
    if (!reel) {
        closeCaseModal();
        showResultModal(prize, casePrice);
        isSpinning = false;
        document.getElementById('btn-spin').disabled = false;
        return;
    }
    
    const itemWidth = 120;
    const containerWidth = reel.parentElement.offsetWidth;
    const targetPos = (finalPrizeIndex * itemWidth) - (containerWidth / 2) + (itemWidth / 2);

    // МГНОВЕННАЯ остановка
    reel.style.transition = 'transform 0.2s ease-out';
    reel.style.transform = `translateX(${-targetPos}px)`;

    setTimeout(() => {
        closeCaseModal();
        showResultModal(prize, casePrice);
        isSpinning = false;
        document.getElementById('btn-spin').disabled = false;
        reelItems = [];
        
        userData.total_games = (userData.total_games || 0) + 1;
        if (prize.value > casePrice) {
            userData.total_wins = (userData.total_wins || 0) + 1;
        }
        updateUserLevel();
    }, 200); // Мгновенно
}

// Звуковые эффекты
let spinSoundInterval = null;

function playSound(type) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        let frequency, duration, volume;
        
        switch(type) {
            case 'open':
                // Мягкий звук открытия
                frequency = 440; // Нота A (Ля)
                duration = 0.1;
                volume = 0.12;
                break;
            case 'spin':
                // Приятный мягкий тик (как механические часы)
                frequency = 880; // Нота A октавой выше
                duration = 0.03;
                volume = 0.05;
                break;
            case 'win':
                playWinSound();
                return;
            case 'lose':
                frequency = 220;
                duration = 0.2;
                volume = 0.08;
                break;
            default:
                return;
        }
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = frequency;
        oscillator.type = 'sine'; // Мягкая синусоида
        
        // Плавное затухание для более приятного звука
        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);
    } catch (e) {
        // Игнорируем ошибки звука
    }
}

function playWinSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C, E, G, C (мажорное трезвучие)
        
        notes.forEach((freq, index) => {
            setTimeout(() => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                oscillator.frequency.value = freq;
                oscillator.type = 'sine';
                
                const volume = 0.3 - (index * 0.05);
                gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
                
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.3);
            }, index * 100);
        });
    } catch (e) {
        console.log('Audio not supported:', e);
    }
}

// Получить TGS версию изображения NFT
function getTgsVersion(imagePath) {
    if (!imagePath) return null;
    
    // Заменяем расширение на .tgs
    const tgsPath = imagePath.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '.tgs');
    return tgsPath;
}

// Загрузка и воспроизведение TGS анимации
function loadTgsAnimation(container, tgsPath) {
    return new Promise((resolve, reject) => {
        // Загружаем TGS файл
        fetch(tgsPath)
            .then(response => {
                if (!response.ok) {
                    reject(new Error('TGS file not found'));
                    return;
                }
                return response.arrayBuffer();
            })
            .then(data => {
                if (!data) {
                    reject(new Error('TGS file is empty'));
                    return;
                }
                
                // Декомпрессируем TGS (это gzip сжатый JSON)
                // TGS файлы нужно распаковать из gzip
                if (typeof pako !== 'undefined') {
                    // Используем pako для декомпрессии
                    try {
                        const decompressed = pako.ungzip(new Uint8Array(data), { to: 'string' });
                        const jsonData = JSON.parse(decompressed);
                        
                        // Создаем Lottie анимацию
                        if (typeof lottie !== 'undefined') {
                            const anim = lottie.loadAnimation({
                                container: container,
                                renderer: 'svg',
                                loop: true,
                                autoplay: true,
                                animationData: jsonData
                            });
                            resolve(anim);
                        } else {
                            reject(new Error('Lottie library not loaded'));
                        }
                    } catch (e) {
                        console.error('Error decompressing TGS:', e);
                        reject(e);
                    }
                } else {
                    // Если pako не загружен, пытаемся использовать встроенный метод
                    // TGS может быть уже JSON (некоторые версии)
                    try {
                        const decoder = new TextDecoder('utf-8');
                        const text = decoder.decode(data);
                        const jsonData = JSON.parse(text);
                        
                        if (typeof lottie !== 'undefined') {
                            const anim = lottie.loadAnimation({
                                container: container,
                                renderer: 'svg',
                                loop: true,
                                autoplay: true,
                                animationData: jsonData
                            });
                            resolve(anim);
                        } else {
                            reject(new Error('Lottie library not loaded'));
                        }
                    } catch (e) {
                        // Если не получилось, пробуем загрузить pako динамически
                        const script = document.createElement('script');
                        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';
                        script.onload = () => {
                            try {
                                const decompressed = pako.ungzip(new Uint8Array(data), { to: 'string' });
                                const jsonData = JSON.parse(decompressed);
                                
                                if (typeof lottie !== 'undefined') {
                                    const anim = lottie.loadAnimation({
                                        container: container,
                                        renderer: 'svg',
                                        loop: true,
                                        autoplay: true,
                                        animationData: jsonData
                                    });
                                    resolve(anim);
                                } else {
                                    reject(new Error('Lottie library not loaded'));
                                }
                            } catch (err) {
                                reject(err);
                            }
                        };
                        script.onerror = () => reject(new Error('Failed to load pako'));
                        document.head.appendChild(script);
                    }
                }
            })
            .catch(reject);
    });
}

// Показ модального окна результата
function showResultModal(prize, casePrice) {
    const resultIcon = document.getElementById('result-icon');
    resultIcon.innerHTML = ''; // Очищаем содержимое
    
    if (prize.image) {
        // Пробуем загрузить TGS версию
        const tgsPath = getTgsVersion(prize.image);
        const fallbackIcon = getItemIcon(prize.value);
        
        // Создаем контейнер для анимации
        const animContainer = document.createElement('div');
        animContainer.style.position = 'relative';
        animContainer.style.width = '120px';
        animContainer.style.height = '120px';
        animContainer.style.margin = '0 auto';
        animContainer.style.borderRadius = '16px';
        animContainer.style.overflow = 'hidden';
        
        // Контейнер для TGS анимации
        const tgsContainer = document.createElement('div');
        tgsContainer.style.width = '100%';
        tgsContainer.style.height = '100%';
        tgsContainer.style.position = 'absolute';
        tgsContainer.style.top = '0';
        tgsContainer.style.left = '0';
        tgsContainer.style.opacity = '0';
        tgsContainer.style.transition = 'opacity 0.3s ease';
        
        // Создаем статичное изображение (fallback)
        const staticImg = document.createElement('img');
        staticImg.src = prize.image;
        staticImg.alt = prize.name;
        staticImg.style.width = '100%';
        staticImg.style.height = '100%';
        staticImg.style.objectFit = 'contain';
        staticImg.style.position = 'absolute';
        staticImg.style.top = '0';
        staticImg.style.left = '0';
        staticImg.style.opacity = '0';
        staticImg.style.transition = 'opacity 0.3s ease';
        staticImg.style.borderRadius = '16px';
        
        // Fallback иконка
        const iconFallback = document.createElement('div');
        iconFallback.textContent = fallbackIcon;
        iconFallback.style.fontSize = '6rem';
        iconFallback.style.display = 'none';
        
        let tgsLoaded = false;
        let staticLoaded = false;
        let tgsAnimation = null;
        
        // Пробуем загрузить TGS анимацию
        loadTgsAnimation(tgsContainer, tgsPath)
            .then(anim => {
                tgsLoaded = true;
                tgsAnimation = anim;
                // Показываем TGS анимацию
                tgsContainer.style.opacity = '1';
                staticImg.style.opacity = '0';
                console.log('TGS анимация NFT загружена:', tgsPath);
            })
            .catch(err => {
                console.log('TGS анимация не найдена, используем статичное изображение:', err);
                // Если TGS не загрузился, показываем статичное изображение
                if (staticLoaded) {
                    staticImg.style.opacity = '1';
                    tgsContainer.style.opacity = '0';
                }
            });
        
        // Обработка загрузки статичного изображения
        staticImg.onload = () => {
            staticLoaded = true;
            // Если TGS не загрузился, показываем статичное изображение
            if (!tgsLoaded) {
                staticImg.style.opacity = '1';
                tgsContainer.style.opacity = '0';
            }
        };
        
        staticImg.onerror = () => {
            // Если статичное изображение не загрузилось, показываем иконку
            if (!staticLoaded && !tgsLoaded) {
                staticImg.style.display = 'none';
                tgsContainer.style.display = 'none';
                iconFallback.style.display = 'block';
            }
        };
        
        animContainer.appendChild(tgsContainer);
        animContainer.appendChild(staticImg);
        animContainer.appendChild(iconFallback);
        resultIcon.appendChild(animContainer);
        
        // Сохраняем ссылку на анимацию для возможной очистки
        resultIcon._tgsAnimation = tgsAnimation;
    } else {
        // Если нет изображения, показываем только иконку
        resultIcon.textContent = getItemIcon(prize.value);
    }
    
    document.getElementById('result-item-name').textContent = prize.name;

    const prizeValue = prize.value;
    const profit = prizeValue - casePrice;
    const prizeContainer = document.getElementById('result-prize-container');
    const prizeAmount = document.getElementById('result-prize-amount');

    if (profit > 0) {
        prizeContainer.className = 'result-prize profit';
        prizeAmount.textContent = `+${profit.toFixed(2)}`;
        playSound('win');
    } else {
        prizeContainer.className = 'result-prize loss';
        prizeAmount.textContent = `${profit.toFixed(2)}`;
        playSound('lose');
    }

    document.getElementById('result-new-balance').textContent = (Math.round(userData.balance * 100) / 100).toFixed(2);

    document.getElementById('result-modal').classList.remove('hidden');

    // Загружаем инвентарь после открытия кейса
    loadInventory();
}

// Закрытие модального окна результата
function closeResultModal() {
    const resultIcon = document.getElementById('result-icon');
    
    // Останавливаем и удаляем TGS анимацию если она есть
    if (resultIcon._tgsAnimation) {
        resultIcon._tgsAnimation.destroy();
        resultIcon._tgsAnimation = null;
    }
    
    document.getElementById('result-modal').classList.add('hidden');
}

// Показ модального окна для просмотра предмета из инвентаря
function showItemAnimationModal(itemImage, itemName, itemValue) {
    const modal = document.getElementById('item-view-modal');
    const iconContainer = document.getElementById('item-view-icon');
    const nameElement = document.getElementById('item-view-name');
    const valueElement = document.getElementById('item-view-value');
    
    // Очищаем предыдущее содержимое
    iconContainer.innerHTML = '';
    nameElement.textContent = itemName || 'Item';
    valueElement.textContent = `${itemValue.toFixed(2)} TON`;
    
    if (itemImage) {
        // Получаем TGS версию изображения
        const tgsPath = getTgsVersion(itemImage);
        const fallbackIcon = getItemIcon(itemValue);
        
        // Создаем контейнер для анимации
        const animContainer = document.createElement('div');
        animContainer.style.position = 'relative';
        animContainer.style.width = '200px';
        animContainer.style.height = '200px';
        animContainer.style.margin = '0 auto';
        animContainer.style.borderRadius = '16px';
        animContainer.style.overflow = 'hidden';
        
        // Контейнер для TGS анимации
        const tgsContainer = document.createElement('div');
        tgsContainer.style.width = '100%';
        tgsContainer.style.height = '100%';
        tgsContainer.style.position = 'absolute';
        tgsContainer.style.top = '0';
        tgsContainer.style.left = '0';
        tgsContainer.style.opacity = '0';
        tgsContainer.style.transition = 'opacity 0.3s ease';
        
        // Создаем статичное изображение (fallback)
        const staticImg = document.createElement('img');
        staticImg.src = itemImage;
        staticImg.alt = itemName;
        staticImg.style.width = '100%';
        staticImg.style.height = '100%';
        staticImg.style.objectFit = 'contain';
        staticImg.style.position = 'absolute';
        staticImg.style.top = '0';
        staticImg.style.left = '0';
        staticImg.style.opacity = '0';
        staticImg.style.transition = 'opacity 0.3s ease';
        staticImg.style.borderRadius = '16px';
        
        // Fallback иконка
        const iconFallback = document.createElement('div');
        iconFallback.textContent = fallbackIcon;
        iconFallback.style.fontSize = '8rem';
        iconFallback.style.display = 'none';
        
        let tgsLoaded = false;
        let staticLoaded = false;
        let tgsAnimation = null;
        
        // Пробуем загрузить TGS анимацию
        loadTgsAnimation(tgsContainer, tgsPath)
            .then(anim => {
                tgsLoaded = true;
                tgsAnimation = anim;
                // Показываем TGS анимацию
                tgsContainer.style.opacity = '1';
                staticImg.style.opacity = '0';
                console.log('TGS анимация NFT загружена:', tgsPath);
            })
            .catch(err => {
                console.log('TGS анимация не найдена, используем статичное изображение:', err);
                // Если TGS не загрузился, показываем статичное изображение
                if (staticLoaded) {
                    staticImg.style.opacity = '1';
                    tgsContainer.style.opacity = '0';
                }
            });
        
        // Обработка загрузки статичного изображения
        staticImg.onload = () => {
            staticLoaded = true;
            // Если TGS не загрузился, показываем статичное изображение
            if (!tgsLoaded) {
                staticImg.style.opacity = '1';
                tgsContainer.style.opacity = '0';
            }
        };
        
        staticImg.onerror = () => {
            // Если статичное изображение не загрузилось, показываем иконку
            if (!staticLoaded && !tgsLoaded) {
                staticImg.style.display = 'none';
                tgsContainer.style.display = 'none';
                iconFallback.style.display = 'block';
            }
        };
        
        animContainer.appendChild(tgsContainer);
        animContainer.appendChild(staticImg);
        animContainer.appendChild(iconFallback);
        iconContainer.appendChild(animContainer);
        
        // Сохраняем ссылку на анимацию для возможной очистки
        iconContainer._tgsAnimation = tgsAnimation;
    } else {
        // Если нет изображения, показываем только иконку
        iconContainer.textContent = getItemIcon(itemValue);
    }
    
    // Показываем модальное окно
    modal.classList.remove('hidden');
}

// Закрытие модального окна просмотра предмета
function closeItemViewModal() {
    const iconContainer = document.getElementById('item-view-icon');
    
    // Останавливаем и удаляем TGS анимацию если она есть
    if (iconContainer._tgsAnimation) {
        iconContainer._tgsAnimation.destroy();
        iconContainer._tgsAnimation = null;
    }
    
    document.getElementById('item-view-modal').classList.add('hidden');
}

function loadInventory() {
    if (socket?.connected && playerId) {
        socket.emit("message", {
            action: "get_inventory",
            player_id: playerId
        });
    }
}

function renderInventory() {
    const grid = document.getElementById('inventory-grid');

    if (!currentInventory || currentInventory.length === 0) {
        grid.innerHTML = `
            <div class="inventory-empty">
                <div class="inventory-empty-icon">📦</div>
                <div>Инвентарь пуст</div>
                <div style="margin-top: 8px; font-size: 0.85rem;">Открывайте кейсы, чтобы получить предметы</div>
            </div>
        `;
        return;
    }

    grid.innerHTML = '';
    currentInventory.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'inventory-item';
        itemDiv.style.cursor = 'pointer';
        
        // Используем изображение если есть, иначе иконку
        const imageContent = item.image 
            ? `<img src="${item.image}" alt="${item.name}" class="inventory-item-image" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" /><div class="inventory-item-icon" style="display: none;">${getItemIcon(item.value)}</div>`
            : `<div class="inventory-item-icon">${getItemIcon(item.value)}</div>`;
        
        itemDiv.innerHTML = `
            <div class="inventory-item-preview" data-item-id="${item.id}" data-item-image="${item.image || ''}" data-item-name="${item.name || ''}" data-item-value="${item.value || 0}">
                ${imageContent}
            <div class="inventory-item-name">${item.name}</div>
                <div class="inventory-item-value">
                    <img src="https://ton.org/download/ton_symbol.png" alt="TON" style="width: 14px; height: 14px;">
                    ${item.value.toFixed(2)}
                </div>
            </div>
            <button class="btn-sell-item" data-item-id="${item.id}">
                <i class="fas fa-money-bill-wave"></i> Продать
            </button>
        `;
        grid.appendChild(itemDiv);
    });

    // Обработчик клика на предмет для просмотра анимации
    document.querySelectorAll('.inventory-item-preview').forEach(preview => {
        preview.addEventListener('click', (e) => {
            // Предотвращаем клик, если кликнули на кнопку продажи
            if (e.target.closest('.btn-sell-item')) {
                return;
            }
            
            const itemImage = preview.dataset.itemImage;
            const itemName = preview.dataset.itemName;
            const itemValue = parseFloat(preview.dataset.itemValue);
            
            if (itemImage) {
                showItemAnimationModal(itemImage, itemName, itemValue);
            }
        });
    });

    document.querySelectorAll('.btn-sell-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Останавливаем всплытие события
            const itemId = parseInt(btn.dataset.itemId);
            sellItem(itemId);
        });
    });
}

// Продажа предмета
function sellItem(itemId) {
    if (socket?.connected && playerId) {
        socket.emit("message", {
            action: "sell_item",
            player_id: playerId,
            item_id: itemId
        });
    }
}

// Продажа всех предметов
function sellAllItems() {
    if (!currentInventory || currentInventory.length === 0) {
        showToast('Инвентарь пуст', 'error');
        return;
    }

    if (confirm(`Продать все предметы (${currentInventory.length} шт.)?`)) {
        if (socket?.connected && playerId) {
            socket.emit("message", {
                action: "sell_all_items",
                player_id: playerId
            });
        }
    }
}

// Tab Switcher
const tabButtons = document.querySelectorAll('.tab-button');
tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.getElementById('cases-tab').classList.add('hidden');
        document.getElementById('crash-tab').classList.add('hidden');

        if (tab === 'cases') document.getElementById('cases-tab').classList.remove('hidden');
        else if (tab === 'crash') document.getElementById('crash-tab').classList.remove('hidden');
    });
});

// Bottom Navigation
const navButtons = document.querySelectorAll('.nav-btn');
navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const nav = btn.dataset.nav;
        navButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.getElementById('cases-tab').classList.add('hidden');
        document.getElementById('crash-tab').classList.add('hidden');
        document.getElementById('profile-tab').classList.add('hidden');
        document.getElementById('inventory-tab').classList.add('hidden');

        if (nav === 'cases') {
            document.getElementById('cases-tab').classList.remove('hidden');
            tabButtons[0].classList.add('active');
            tabButtons[1].classList.remove('active');
        } else if (nav === 'crash') {
            document.getElementById('crash-tab').classList.remove('hidden');
            tabButtons[0].classList.remove('active');
            tabButtons[1].classList.add('active');
        } else if (nav === 'inventory') {
            document.getElementById('inventory-tab').classList.remove('hidden');
            loadInventory();
        } else if (nav === 'profile') {
            document.getElementById('profile-tab').classList.remove('hidden');
            updateProfileData();
        }
    });
});

// Quick bet buttons
const quickBetButtons = document.querySelectorAll('.quick-bet-btn');
quickBetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const amount = btn.dataset.amount;
        document.getElementById('bet-amount').value = amount;
        quickBetButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// Загрузка изображений кейсов
function loadCaseImages() {
    const caseCards = document.querySelectorAll('.case-card');
    caseCards.forEach(card => {
        const caseType = card.dataset.case;
        const img = card.querySelector('.case-image');
        const gif = card.querySelector('.case-gif');
        const iconWrapper = card.querySelector('.case-icon-wrapper');
        
        if (img && iconWrapper) {
            // Загружаем PNG изображение (статичное)
            const imageNames = ['case', caseType, '1', 'box'];
            const extensions = ['.png', '.jpg', '.jpeg'];
            
            let currentNameIndex = 0;
            let currentExtIndex = 0;
            let imageLoaded = false;
            
            const tryNextImage = () => {
                if (imageLoaded) return;
                
                if (currentNameIndex >= imageNames.length) {
                    // Все варианты перепробованы - показываем иконку
                    img.style.display = 'none';
                    if (gif) gif.style.display = 'none';
                    iconWrapper.style.display = 'block';
                    return;
                }
                
                const imageName = imageNames[currentNameIndex];
                const extension = extensions[currentExtIndex];
                const imagePath = `/static/images/cases/${caseType}/${imageName}${extension}`;
                
                // Пробуем загрузить изображение
                const testImg = new Image();
                testImg.onload = () => {
                    if (!imageLoaded) {
                        imageLoaded = true;
                        img.src = imagePath;
                        img.style.display = 'block';
                        img.style.opacity = '1';
                        iconWrapper.style.display = 'none';
                        img.onerror = null;
                    }
                };
                
                testImg.onerror = () => {
                    // Пробуем следующее расширение
                    currentExtIndex++;
                    if (currentExtIndex >= extensions.length) {
                        currentExtIndex = 0;
                        currentNameIndex++;
                    }
                    // Пробуем следующий вариант
                    setTimeout(tryNextImage, 10);
                };
                
                testImg.src = imagePath;
            };
            
            // Обработчик ошибки для основного изображения
            img.onerror = () => {
                if (!imageLoaded) {
                    tryNextImage();
                }
            };
            
            // Загружаем GIF анимацию (для клика)
            if (gif) {
                const gifNames = ['case', caseType, 'animation', 'animated'];
                const gifExtensions = ['.gif'];
                
                let gifLoaded = false;
                let gifNameIndex = 0;
                
                const tryNextGif = () => {
                    if (gifLoaded) return;
                    
                    if (gifNameIndex >= gifNames.length) {
                        return; // GIF не найден, это нормально
                    }
                    
                    const gifName = gifNames[gifNameIndex];
                    const gifPath = `/static/images/cases/${caseType}/${gifName}.gif`;
                    
                    const testGif = new Image();
                    testGif.onload = () => {
                        if (!gifLoaded) {
                            gifLoaded = true;
                            gif.src = gifPath;
                            gif.style.opacity = '0';
                        }
                    };
                    
                    testGif.onerror = () => {
                        gifNameIndex++;
                        if (gifNameIndex < gifNames.length) {
                            setTimeout(tryNextGif, 10);
                        }
                    };
                    
                    testGif.src = gifPath;
                };
                
                tryNextGif();
            }
            
            // Начинаем попытки загрузки
            tryNextImage();
        }
    });
}

// Анимация кейса при клике
function animateCaseOnClick(card) {
    const caseType = card.dataset.case;
    const img = card.querySelector('.case-image');
    const gif = card.querySelector('.case-gif');
    
    if (gif && gif.src) {
        // Показываем GIF анимацию
        img.style.opacity = '0';
        gif.style.display = 'block';
        gif.style.opacity = '1';
        
        // После окончания анимации возвращаем PNG (через 2 секунды или после окончания цикла)
        setTimeout(() => {
            gif.style.opacity = '0';
            setTimeout(() => {
                gif.style.display = 'none';
                img.style.opacity = '1';
            }, 300);
        }, 2000);
    }
}

// Case cards
const caseCards = document.querySelectorAll('.case-card');
caseCards.forEach(card => {
    // Анимация при клике
    card.addEventListener('click', () => {
        const caseType = card.dataset.case;
        const price = parseFloat(card.dataset.price);

        console.log('Открываем меню кейса:', caseType, 'Цена:', price);

        if (!playerId || !socket?.connected) {
            showToast('Нет подключения к серверу', 'error');
            return;
        }

        // Показываем GIF анимацию при клике
        animateCaseOnClick(card);

        // Открываем модальное окно с барабаном
        openCaseModal(caseType, price);
    });
    
    // Дополнительная анимация при наведении (опционально)
    card.addEventListener('mouseenter', () => {
        const gif = card.querySelector('.case-gif');
        if (gif && gif.src) {
            // Можно добавить легкую анимацию при наведении
        }
    });
});

// Закрытие модалов
document.getElementById('modal-close-btn').addEventListener('click', closeCaseModal);
document.getElementById('btn-cancel-spin').addEventListener('click', closeCaseModal);
document.getElementById('btn-result-close').addEventListener('click', closeResultModal);
document.getElementById('item-view-close').addEventListener('click', closeItemViewModal);
document.getElementById('item-view-close-btn').addEventListener('click', closeItemViewModal);

// Кнопка вращения
document.getElementById('btn-spin').addEventListener('click', startSpin);

// Sell all items
document.getElementById('sell-all-btn').addEventListener('click', sellAllItems);

// Refresh balance
document.getElementById('refresh-balance').addEventListener('click', () => {
    if (socket?.connected && playerId) {
        // Просто обновляем отображение из userData
        updateBalance(userData.balance);
        showToast('Баланс обновлен', 'success');
    }
});

// Login
document.getElementById('telegram-login-btn').addEventListener('click', () => {
    if (tg.initDataUnsafe?.user) {
        handleTelegramAuth(tg.initDataUnsafe);
    } else {
        showToast('Откройте в Telegram', 'error');
    }
});

// Place Bet
document.getElementById('place-bet').addEventListener('click', () => {
    const betAmount = parseFloat(document.getElementById('bet-amount').value);
    const autoCashout = parseFloat(document.getElementById('auto-cashout').value) || 0;

    if (!betAmount || betAmount < 50) {
        showToast('Минимум: 50 TON', 'error');
        return;
    }

    if (betAmount > userData.balance) {
        showToast('Недостаточно средств', 'error');
        return;
    }

    if (socket?.connected && playerId) {
        socket.emit("message", {
            action: "place_bet",
            player_id: playerId,
            bet_amount: betAmount,
            auto_cashout: autoCashout
        });
    } else {
        showToast('Нет подключения к серверу', 'error');
    }
});

// Cashout
document.getElementById('cashout').addEventListener('click', () => {
    if (socket?.connected && playerId) {
        socket.emit("message", {
            action: "cashout",
            player_id: playerId
        });
    }
});

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm('Вы уверены, что хотите выйти?')) {
        localStorage.clear();
        if (socket) {
            socket.disconnect();
        }
        location.reload();
    }
});

// TON Connect
try {
    tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
        manifestUrl: window.location.origin + "/tonconnect-manifest.json",
        buttonRootId: 'ton-connect-button'
    });

    tonConnectUI.uiOptions = {
        language: 'ru',
        uiPreferences: { theme: 'DARK' }
    };

    tonConnectUI.onStatusChange(wallet => {
        if (wallet && wallet.account) {
            const address = wallet.account.address;
            document.getElementById('wallet-status-text').textContent = `${address.slice(0,6)}...${address.slice(-6)}`;

            if (socket?.connected && playerId) {
                socket.emit("message", {
                    action: "connect_wallet",
                    player_id: playerId,
                    wallet_data: { address }
                });
            }
        } else {
            document.getElementById('wallet-status-text').textContent = "Не подключен";
        }
    });
} catch (error) {
    console.error('TON Connect error:', error);
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    connectSocket();
    loadCaseImages();
});