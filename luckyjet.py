import asyncio
import json
import random
import time
import logging
from typing import Dict, List, Set
from dataclasses import dataclass, asdict
import uuid
import sqlite3
from pathlib import Path
import socketio
from aiohttp import web
import aiohttp_cors
import os

BOT_TOKEN = "8312800646:AAH1CkHe0MFpzXmQaAgWXDlDbJ6hHqW7x_g"
BOT_USERNAME = "@NftViewGifFt_bot"

TONAPI_KEY = "AE446JRXOT6K7JAAAAAEQJ27C4T3ARSD4UE4G4PCLOKHLQBI4KFTPFRNIYQGZ62P676Y4HY"
TONAPI_BASE = "https://tonapi.io/v2"

SERVER_URL = "https://ruefully-visionary-cod.cloudpub.ru"

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

sio = socketio.AsyncServer(cors_allowed_origins="*")

# Конфигурация предметов для кейсов с изображениями
CASE_ITEMS = {
    "starter": [
        {"image_folder": "1", "name": "Common Item", "value": 1, "chance": 40},
        {"image_folder": "2", "name": "Uncommon Item", "value": 2, "chance": 30},
        {"image_folder": "5", "name": "Rare Item", "value": 5, "chance": 20},
        {"image_folder": "10", "name": "Epic Item", "value": 10, "chance": 10},
    ],
    "premium": [
        {"image_folder": "2", "name": "Uncommon Item", "value": 2, "chance": 35},
        {"image_folder": "5", "name": "Rare Item", "value": 5, "chance": 30},
        {"image_folder": "10", "name": "Epic Item", "value": 10, "chance": 20},
        {"image_folder": "50", "name": "Legendary Item", "value": 50, "chance": 15},
    ],
    "gold": [
        {"image_folder": "5", "name": "Rare Item", "value": 5, "chance": 35},
        {"image_folder": "10", "name": "Epic Item", "value": 10, "chance": 30},
        {"image_folder": "50", "name": "Legendary Item", "value": 50, "chance": 25},
        {"image_folder": "100", "name": "Mythic Item", "value": 100, "chance": 10},
    ],
    "jackpot": [
        {"image_folder": "10", "name": "Epic Item", "value": 10, "chance": 30},
        {"image_folder": "50", "name": "Legendary Item", "value": 50, "chance": 35},
        {"image_folder": "100", "name": "Mythic Item", "value": 100, "chance": 25},
        {"image_folder": "100", "name": "Ultra Mythic", "value": 100, "chance": 10},
    ],
    "mega": [
        {"image_folder": "50", "name": "Legendary Item", "value": 50, "chance": 35},
        {"image_folder": "100", "name": "Mythic Item", "value": 100, "chance": 40},
        {"image_folder": "100", "name": "Ultra Mythic", "value": 100, "chance": 25},
    ],
    "ultimate": [
        {"image_folder": "100", "name": "Mythic Item", "value": 100, "chance": 60},
        {"image_folder": "100", "name": "Ultra Mythic", "value": 100, "chance": 40},
    ],
}


@dataclass
class Player:
    id: str
    name: str
    balance: float
    sid: str
    telegram_id: str = ""
    wallet_address: str = ""
    current_bet: float = 0
    has_bet: bool = False
    cashed_out: bool = False
    cashout_multiplier: float = 0.0
    auto_cashout: float = 0.0
    total_games: int = 0
    total_wins: int = 0
    best_multiplier: float = 1.0
    session_token: str = ""
    is_wallet_connected: bool = False


@dataclass
class GameState:
    state: str = "waiting"
    multiplier: float = 1.0
    crash_point: float = 0.0
    start_time: float = 0.0
    round_number: int = 1
    countdown: int = 15


class LuckyJetServer:
    def __init__(self):
        self.players: Dict[str, Player] = {}
        self.game_state = GameState()
        self.history: List[float] = []
        self.connected_clients: Set = set()
        self.db = sqlite3.connect("luckyjet.db", check_same_thread=False)
        self.setup_database()
        self.game_loop_task = None
        self.last_round_time = time.time()
        self.min_bet = 50
        self.max_multiplier = 3.0
        self.images_cache = {}  # Кеш доступных изображений

    def setup_database(self):
        cursor = self.db.cursor()
        cursor.execute('''
                       CREATE TABLE IF NOT EXISTS users
                       (
                           id
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           telegram_id
                           TEXT
                           UNIQUE,
                           username
                           TEXT,
                           first_name
                           TEXT,
                           last_name
                           TEXT,
                           balance
                           REAL
                           DEFAULT
                           1000,
                           wallet_address
                           TEXT
                           DEFAULT
                           '',
                           is_wallet_connected
                           BOOLEAN
                           DEFAULT
                           0,
                           total_games
                           INTEGER
                           DEFAULT
                           0,
                           total_wins
                           INTEGER
                           DEFAULT
                           0,
                           best_multiplier
                           REAL
                           DEFAULT
                           1.0,
                           session_token
                           TEXT,
                           created_at
                           TIMESTAMP
                           DEFAULT
                           CURRENT_TIMESTAMP,
                           last_login
                           TIMESTAMP
                           DEFAULT
                           CURRENT_TIMESTAMP
                       )
                       ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_telegram_id ON users(telegram_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_session_token ON users(session_token)')

        # Таблица инвентаря с изображениями
        cursor.execute('''
                       CREATE TABLE IF NOT EXISTS inventory
                       (
                           id
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           telegram_id
                           TEXT,
                           item_image
                           TEXT,
                           item_name
                           TEXT,
                           item_value
                           REAL,
                           case_type
                           TEXT,
                           obtained_at
                           TIMESTAMP
                           DEFAULT
                           CURRENT_TIMESTAMP,
                           FOREIGN
                           KEY
                       (
                           telegram_id
                       ) REFERENCES users
                       (
                           telegram_id
                       )
                           )
                       ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_inventory_telegram ON inventory(telegram_id)')
        self.db.commit()

    def get_random_image_from_folder(self, folder_name: str) -> str:
        """Получить случайное изображение из папки (item1.png - item10.png)"""
        folder_path = Path("images") / folder_name

        if not folder_path.exists():
            logger.warning(f"Папка {folder_path} не существует")
            return f"/static/images/default.png"

        # Ищем файлы item1.png, item2.png, ... item10.png
        available_items = []
        for i in range(1, 11):
            for ext in ['.png', '.gif']:
                item_file = folder_path / f"item{i}{ext}"
                if item_file.exists():
                    available_items.append(f"item{i}{ext}")
                    break  # Берем первый найденный формат (png или gif)
        
        if not available_items:
            logger.warning(f"В папке {folder_path} нет изображений item1-item10")
            return f"/static/images/default.png"
        
        random_image = random.choice(available_items)
        return f"/static/images/{folder_name}/{random_image}"
    
    def get_item_image_path(self, folder_name: str, item_number: int) -> str:
        """Получить путь к изображению предмета по номеру (item1-item10)"""
        folder_path = Path("images") / folder_name
        
        if not folder_path.exists():
            return f"/static/images/default.png"
        
        # Пробуем найти PNG или GIF
        for ext in ['.png', '.gif']:
            item_file = folder_path / f"item{item_number}{ext}"
            if item_file.exists():
                return f"/static/images/{folder_name}/item{item_number}{ext}"
        
        return f"/static/images/default.png"

    def get_case_image(self, case_type: str) -> str:
        """Получить изображение кейса"""
        case_images_path = Path("images") / "cases" / case_type

        if not case_images_path.exists():
            logger.warning(f"Папка {case_images_path} не существует")
            return None

        # Ищем первое доступное изображение
        images = [f for f in case_images_path.iterdir() if f.suffix.lower() in ['.png', '.jpg', '.jpeg', '.gif']]
        if not images:
            logger.warning(f"В папке {case_images_path} нет изображений")
            return None

        # Возвращаем первое изображение (можно сделать случайное)
        return f"/static/images/cases/{case_type}/{images[0].name}"

    def verify_telegram_auth(self, auth_data: Dict) -> bool:
        try:
            if 'user' not in auth_data:
                logger.warning("Отсутствует поле user в auth_data")
                return False
            return True
        except Exception as e:
            logger.error(f"Ошибка верификации Telegram: {e}")
            return False

    def generate_case_items(self, case_type: str, count: int = 60) -> List[Dict]:
        """Генерация предметов для барабана кейса"""
        items = CASE_ITEMS.get(case_type, CASE_ITEMS["starter"])

        weighted_items = []
        for item in items:
            weighted_items.extend([item] * item["chance"])

        generated = []
        for _ in range(count):
            item = random.choice(weighted_items)
            image_path = self.get_random_image_from_folder(item["image_folder"])
            generated.append({
                "image": image_path,
                "name": item["name"],
                "value": item["value"]
            })

        return generated

    def generate_case_items_with_prize(self, case_type: str, prize: Dict, prize_index: int = 5, count: int = 10) -> List[Dict]:
        """Генерация предметов для барабана кейса с гарантированным выигрышным предметом"""
        items = CASE_ITEMS.get(case_type, CASE_ITEMS["starter"])

        weighted_items = []
        for item in items:
            weighted_items.extend([item] * item["chance"])

        generated = []
        for i in range(count):
            if i == prize_index:
                # Вставляем выигрышный предмет в нужную позицию
                generated.append({
                    "image": prize["image"],
                    "name": prize["name"],
                    "value": prize["value"]
                })
            else:
                # Генерируем случайный предмет с рандомным изображением
                item = random.choice(weighted_items)
                item_number = random.randint(1, 10)
                image_path = self.get_item_image_path(item["image_folder"], item_number)
                generated.append({
                    "image": image_path,
                    "name": item["name"],
                    "value": item["value"]
                })

        return generated

    def select_case_prize(self, case_type: str) -> Dict:
        """Выбор выигрышного предмета из кейса"""
        items = CASE_ITEMS.get(case_type, CASE_ITEMS["starter"])

        weighted_items = []
        for item in items:
            weighted_items.extend([item] * item["chance"])

        selected = random.choice(weighted_items)
        
        # Выбираем случайный номер предмета от 1 до 10
        item_number = random.randint(1, 10)
        image_path = self.get_item_image_path(selected["image_folder"], item_number)

        return {
            "image": image_path,
            "name": selected["name"],
            "value": selected["value"],
            "item_number": item_number,  # Сохраняем номер предмета
            "folder": selected["image_folder"]  # Сохраняем папку
        }

    async def open_case(self, player_id: str, case_type: str, price: float) -> Dict:
        """Открытие кейса"""
        try:
            player = self.players.get(player_id)
            if not player:
                return {"success": False, "message": "Игрок не найден"}

            if player.balance < price:
                return {"success": False, "message": f"Недостаточно средств. Нужно {price} TON"}

            # Списываем стоимость кейса
            player.balance = round(player.balance - price, 2)

            # Выбираем выигрыш ДО генерации барабана
            prize = self.select_case_prize(case_type)

            # Генерируем короткий барабан: 10 элементов, приз на позиции 5
            reel_items = self.generate_case_items_with_prize(case_type, prize, prize_index=5, count=10)

            # Добавляем предмет в инвентарь
            if player.telegram_id:
                cursor = self.db.cursor()
                cursor.execute('''
                               INSERT INTO inventory (telegram_id, item_image, item_name, item_value, case_type)
                               VALUES (?, ?, ?, ?, ?)
                               ''', (player.telegram_id, prize["image"], prize["name"], prize["value"], case_type))
                self.db.commit()

            player.total_games += 1

            if prize["value"] > price:
                player.total_wins += 1

            # Обновляем в БД
            if player.telegram_id:
                self.update_user_balance(player.telegram_id, player.balance)
                self.update_user_stats(
                    player.telegram_id,
                    player.total_games,
                    player.total_wins,
                    player.best_multiplier
                )

            logger.info(f"Игрок {player.name} открыл {case_type} кейс и получил {prize['value']} TON ({prize['name']})")

            return {
                "success": True,
                "prize": prize,
                "balance": player.balance,
                "reel_items": reel_items,
                "case_type": case_type,
                "prize_index": 5,  # Индекс выигрышного предмета в списке (из 10)
                "case_price": price  # Цена кейса для сравнения с призом
            }

        except Exception as e:
            logger.error(f"Ошибка открытия кейса: {e}", exc_info=True)
            return {"success": False, "message": f"Ошибка сервера: {str(e)}"}

    async def get_inventory(self, player_id: str) -> Dict:
        """Получить инвентарь игрока"""
        try:
            player = self.players.get(player_id)
            if not player or not player.telegram_id:
                return {"success": False, "message": "Игрок не найден"}

            cursor = self.db.cursor()
            cursor.execute('''
                           SELECT id, item_image, item_name, item_value, case_type, obtained_at
                           FROM inventory
                           WHERE telegram_id = ?
                           ORDER BY obtained_at DESC
                           ''', (player.telegram_id,))

            items = []
            for row in cursor.fetchall():
                items.append({
                    "id": row[0],
                    "image": row[1],
                    "name": row[2],
                    "value": row[3],
                    "case_type": row[4],
                    "obtained_at": row[5]
                })

            return {
                "success": True,
                "items": items
            }

        except Exception as e:
            logger.error(f"Ошибка получения инвентаря: {e}", exc_info=True)
            return {"success": False, "message": str(e)}

    async def sell_item(self, player_id: str, item_id: int) -> Dict:
        """Продать предмет из инвентаря"""
        try:
            player = self.players.get(player_id)
            if not player or not player.telegram_id:
                return {"success": False, "message": "Игрок не найден"}

            cursor = self.db.cursor()
            cursor.execute('''
                           SELECT item_value
                           FROM inventory
                           WHERE id = ?
                             AND telegram_id = ?
                           ''', (item_id, player.telegram_id))

            result = cursor.fetchone()
            if not result:
                return {"success": False, "message": "Предмет не найден"}

            item_value = result[0]

            # Удаляем предмет
            cursor.execute('DELETE FROM inventory WHERE id = ?', (item_id,))
            self.db.commit()

            # Начисляем деньги
            player.balance = round(player.balance + item_value, 2)
            self.update_user_balance(player.telegram_id, player.balance)

            return {
                "success": True,
                "balance": player.balance,
                "sold_value": item_value
            }

        except Exception as e:
            logger.error(f"Ошибка продажи предмета: {e}", exc_info=True)
            return {"success": False, "message": str(e)}

    async def sell_all_items(self, player_id: str) -> Dict:
        """Продать все предметы из инвентаря"""
        try:
            player = self.players.get(player_id)
            if not player or not player.telegram_id:
                return {"success": False, "message": "Игрок не найден"}

            cursor = self.db.cursor()
            cursor.execute('''
                           SELECT SUM(item_value)
                           FROM inventory
                           WHERE telegram_id = ?
                           ''', (player.telegram_id,))

            result = cursor.fetchone()
            total_value = result[0] if result[0] else 0

            if total_value == 0:
                return {"success": False, "message": "Инвентарь пуст"}

            # Удаляем все предметы
            cursor.execute('DELETE FROM inventory WHERE telegram_id = ?', (player.telegram_id,))
            self.db.commit()

            # Начисляем деньги
            player.balance = round(player.balance + total_value, 2)
            self.update_user_balance(player.telegram_id, player.balance)

            return {
                "success": True,
                "balance": player.balance,
                "sold_value": total_value
            }

        except Exception as e:
            logger.error(f"Ошибка продажи всех предметов: {e}", exc_info=True)
            return {"success": False, "message": str(e)}

    async def get_case_items_preview(self, case_type: str) -> Dict:
        """Получить список возможных предметов из кейса"""
        items = CASE_ITEMS.get(case_type, CASE_ITEMS["starter"])
        items_with_images = []

        for item in items:
            # Используем item1 для preview (или можно случайный)
            image_path = self.get_item_image_path(item["image_folder"], 1)
            items_with_images.append({
                "image": image_path,
                "name": item["name"],
                "value": item["value"],
                "chance": item["chance"],
                "folder": item["image_folder"]  # Добавляем папку для определения редкости
            })

        # Получаем изображение кейса
        case_image = self.get_case_image(case_type)

        return {
            "success": True,
            "items": items_with_images,
            "case_type": case_type,
            "case_image": case_image
        }

    async def telegram_login(self, auth_data: Dict) -> Dict:
        try:
            logger.info(f"Попытка входа через Telegram: {auth_data}")

            if not auth_data:
                return {"success": False, "message": "Отсутствуют данные авторизации"}

            if not self.verify_telegram_auth(auth_data.copy()):
                logger.warning("Неверные данные авторизации")

            user_str = auth_data.get('user', '{}')
            if not user_str:
                return {"success": False, "message": "Не удалось получить данные пользователя"}

            try:
                user_data = json.loads(user_str) if isinstance(user_str, str) else user_str
            except json.JSONDecodeError as e:
                logger.error(f"Ошибка парсинга user: {e}")
                return {"success": False, "message": "Неверный формат данных пользователя"}

            telegram_id = str(user_data.get('id', ''))
            if not telegram_id:
                return {"success": False, "message": "Не удалось получить ID пользователя"}

            username = user_data.get('username', '')
            first_name = user_data.get('first_name', '')
            last_name = user_data.get('last_name', '')

            cursor = self.db.cursor()
            cursor.execute('SELECT * FROM users WHERE telegram_id = ?', (telegram_id,))
            result = cursor.fetchone()

            session_token = str(uuid.uuid4())

            if result:
                cursor.execute('''
                               UPDATE users
                               SET username      = ?,
                                   first_name    = ?,
                                   last_name     = ?,
                                   session_token = ?,
                                   last_login    = CURRENT_TIMESTAMP
                               WHERE telegram_id = ?
                               ''', (username, first_name, last_name, session_token, telegram_id))

                user_info = {
                    "telegram_id": telegram_id,
                    "name": first_name or username or f"User{telegram_id[-4:]}",
                    "balance": round(result[5], 2),
                    "wallet_address": result[6],
                    "is_wallet_connected": bool(result[7]),
                    "total_games": result[8],
                    "total_wins": result[9],
                    "best_multiplier": result[10]
                }
            else:
                cursor.execute('''
                               INSERT INTO users (telegram_id, username, first_name, last_name, session_token)
                               VALUES (?, ?, ?, ?, ?)
                               ''', (telegram_id, username, first_name, last_name, session_token))

                user_info = {
                    "telegram_id": telegram_id,
                    "name": first_name or username or f"User{telegram_id[-4:]}",
                    "balance": 1000.0,
                    "wallet_address": "",
                    "is_wallet_connected": False,
                    "total_games": 0,
                    "total_wins": 0,
                    "best_multiplier": 1.0
                }

            self.db.commit()

            return {
                "success": True,
                "message": "Успешный вход через Telegram",
                "session_token": session_token,
                "user_data": user_info
            }

        except Exception as e:
            logger.error(f"Ошибка Telegram входа: {e}", exc_info=True)
            return {"success": False, "message": f"Внутренняя ошибка сервера: {str(e)}"}

    async def get_user_by_session(self, session_token: str) -> Dict:
        cursor = self.db.cursor()
        cursor.execute('SELECT * FROM users WHERE session_token = ?', (session_token,))
        result = cursor.fetchone()

        if result:
            return {
                "telegram_id": result[1],
                "name": result[3] or result[2] or f"User{result[1][-4:]}",
                "balance": round(result[5], 2),
                "wallet_address": result[6] or "",
                "is_wallet_connected": bool(result[7]),
                "total_games": result[8],
                "total_wins": result[9],
                "best_multiplier": result[10]
            }
        return None

    def update_user_balance(self, telegram_id: str, new_balance: float):
        try:
            cursor = self.db.cursor()
            cursor.execute('UPDATE users SET balance = ? WHERE telegram_id = ?',
                           (round(new_balance, 2), telegram_id))
            self.db.commit()
        except Exception as e:
            logger.error(f"Ошибка обновления баланса: {e}")

    def update_user_stats(self, telegram_id: str, total_games: int, total_wins: int, best_multiplier: float):
        try:
            cursor = self.db.cursor()
            cursor.execute('''
                           UPDATE users
                           SET total_games     = ?,
                               total_wins      = ?,
                               best_multiplier = ?
                           WHERE telegram_id = ?
                           ''', (total_games, total_wins, best_multiplier, telegram_id))
            self.db.commit()
        except Exception as e:
            logger.error(f"Ошибка обновления статистики: {e}")

    async def connect_wallet(self, player_id: str, wallet_address: str) -> Dict:
        try:
            player = self.players.get(player_id)
            if not player:
                return {"success": False, "message": "Игрок не найден"}

            player.wallet_address = wallet_address
            player.is_wallet_connected = True

            if player.telegram_id:
                cursor = self.db.cursor()
                cursor.execute('''
                               UPDATE users
                               SET wallet_address      = ?,
                                   is_wallet_connected = 1
                               WHERE telegram_id = ?
                               ''', (wallet_address, player.telegram_id))
                self.db.commit()

            logger.info(f"Кошелек {wallet_address} подключен к игроку {player.name}")

            return {
                "success": True,
                "message": "Кошелек успешно подключен",
                "wallet_address": wallet_address
            }

        except Exception as e:
            logger.error(f"Ошибка подключения кошелька: {e}", exc_info=True)
            return {"success": False, "message": f"Ошибка подключения кошелька: {str(e)}"}

    async def register_player(self, sid: str, user_data, session_token: str):
        player_id = str(uuid.uuid4())

        player = Player(
            id=player_id,
            name=user_data["name"],
            balance=round(user_data["balance"], 2),
            sid=sid,
            telegram_id=user_data["telegram_id"],
            wallet_address=user_data.get("wallet_address", ""),
            is_wallet_connected=user_data.get("is_wallet_connected", False),
            total_games=user_data.get("total_games", 0),
            total_wins=user_data.get("total_wins", 0),
            best_multiplier=user_data.get("best_multiplier", 1.0),
            session_token=session_token
        )

        self.players[player_id] = player
        self.connected_clients.add(sid)

        logger.info(f"Игрок {player.name} подключился. SID: {sid}")

        await sio.emit('message', {
            "type": "player_registered",
            "player_id": player_id,
            "player": {
                "name": player.name,
                "balance": player.balance,
                "telegram_id": player.telegram_id,
                "wallet_address": player.wallet_address,
                "is_wallet_connected": player.is_wallet_connected
            },
            "game_state": asdict(self.game_state),
            "history": self.history[-10:],
            "server_settings": {"min_bet": self.min_bet, "max_multiplier": self.max_multiplier}
        }, room=sid)

        return player_id

    async def unregister_player(self, sid: str):
        player_id = None
        for pid, player in self.players.items():
            if player.sid == sid:
                player_id = pid
                break

        if player_id:
            player = self.players[player_id]
            if player.telegram_id:
                self.update_user_balance(player.telegram_id, player.balance)
                self.update_user_stats(
                    player.telegram_id,
                    player.total_games,
                    player.total_wins,
                    player.best_multiplier
                )
            del self.players[player_id]
            logger.info(f"Игрок {player.name} отключился")

        self.connected_clients.discard(sid)

    async def place_bet(self, player_id: str, bet_amount: float, auto_cashout: float = 0.0):
        if self.game_state.state not in ["waiting", "countdown"]:
            return {"success": False, "message": "Ставки не принимаются"}

        player = self.players.get(player_id)
        if not player:
            return {"success": False, "message": "Игрок не найден"}

        if bet_amount < self.min_bet or bet_amount > player.balance:
            return {"success": False, "message": f"Минимальная ставка {self.min_bet}, превышен баланс"}

        player.current_bet = bet_amount
        player.balance = round(player.balance - bet_amount, 2)
        player.has_bet = True
        player.cashed_out = False
        player.auto_cashout = min(auto_cashout, self.max_multiplier) if auto_cashout else 0

        if player.telegram_id:
            self.update_user_balance(player.telegram_id, player.balance)

        return {"success": True, "balance": player.balance}

    async def cashout(self, player_id: str):
        if self.game_state.state != "flying":
            return {"success": False, "message": "Нельзя забрать выигрыш сейчас"}

        player = self.players.get(player_id)
        if not player or not player.has_bet or player.cashed_out:
            return {"success": False, "message": "Нет активной ставки"}

        win_amount = round(player.current_bet * self.game_state.multiplier, 2)
        player.balance = round(player.balance + win_amount, 2)
        player.cashed_out = True
        player.cashout_multiplier = self.game_state.multiplier
        player.total_games += 1
        player.total_wins += 1

        if self.game_state.multiplier > player.best_multiplier:
            player.best_multiplier = self.game_state.multiplier

        if player.telegram_id:
            self.update_user_balance(player.telegram_id, player.balance)
            self.update_user_stats(
                player.telegram_id,
                player.total_games,
                player.total_wins,
                player.best_multiplier
            )

        return {
            "success": True,
            "win_amount": win_amount,
            "multiplier": self.game_state.multiplier,
            "balance": player.balance
        }

    def generate_crash_point(self) -> float:
        return round(1.0 + random.random() * 2.0, 2)

    async def start_countdown(self):
        if self.game_state.state != "waiting":
            return

        self.game_state.state = "starting"

        for countdown in range(15, 0, -1):
            self.game_state.countdown = countdown
            await self.broadcast_game_state()
            await asyncio.sleep(1)

        await self.start_flight()

    async def start_flight(self):
        self.game_state.state = "flying"
        self.game_state.multiplier = 1.0
        self.game_state.start_time = time.time()
        self.game_state.crash_point = self.generate_crash_point()

        logger.info(f"Раунд {self.game_state.round_number} начался. Crash point: {self.game_state.crash_point:.2f}")

        while self.game_state.state == "flying":
            elapsed = time.time() - self.game_state.start_time
            self.game_state.multiplier = round(1.0 + (elapsed * 0.15), 2)

            for player in self.players.values():
                if (player.has_bet and not player.cashed_out and
                        player.auto_cashout > 0 and
                        self.game_state.multiplier >= player.auto_cashout):

                    win_amount = round(player.current_bet * self.game_state.multiplier, 2)
                    player.balance = round(player.balance + win_amount, 2)
                    player.cashed_out = True
                    player.cashout_multiplier = self.game_state.multiplier
                    player.total_games += 1
                    player.total_wins += 1

                    if self.game_state.multiplier > player.best_multiplier:
                        player.best_multiplier = self.game_state.multiplier

                    if player.telegram_id:
                        self.update_user_balance(player.telegram_id, player.balance)
                        self.update_user_stats(
                            player.telegram_id,
                            player.total_games,
                            player.total_wins,
                            player.best_multiplier
                        )

                    await sio.emit('message', {
                        "type": "cashout_result",
                        "result": {
                            "success": True,
                            "win_amount": win_amount,
                            "multiplier": self.game_state.multiplier,
                            "balance": player.balance
                        }
                    }, room=player.sid)

            await self.broadcast_game_state()

            if self.game_state.multiplier >= self.game_state.crash_point:
                await self.crash()
                break

            await asyncio.sleep(0.08)

    async def crash(self):
        self.game_state.state = "crashed"

        for player in self.players.values():
            if player.has_bet and not player.cashed_out:
                player.total_games += 1
                if player.telegram_id:
                    self.update_user_stats(
                        player.telegram_id,
                        player.total_games,
                        player.total_wins,
                        player.best_multiplier
                    )

        self.history.append(self.game_state.multiplier)
        if len(self.history) > 50:
            self.history.pop(0)

        logger.info(f"Раунд {self.game_state.round_number} закончился крашем на {self.game_state.multiplier:.2f}x")

        await self.broadcast_game_state()
        await sio.emit('message', {
            "type": "game_history",
            "history": [{"multiplier": m} for m in self.history[-10:]]
        })

        await asyncio.sleep(5)
        await self.reset_round()

    async def reset_round(self):
        for player in self.players.values():
            player.has_bet = False
            player.current_bet = 0
            player.cashed_out = False
            player.cashout_multiplier = 0.0
            player.auto_cashout = 0.0

        self.game_state.round_number += 1
        self.game_state.state = "waiting"
        self.game_state.multiplier = 1.0
        self.game_state.crash_point = 0.0
        self.game_state.countdown = 15

        await self.broadcast_game_state()

    async def broadcast_game_state(self):
        # Получаем список активных игроков со ставками
        active_players = []
        for player in self.players.values():
            if player.has_bet:
                active_players.append({
                    "name": player.name,
                    "bet": player.current_bet,
                    "cashed_out": player.cashed_out,
                    "multiplier": player.cashout_multiplier if player.cashed_out else self.game_state.multiplier
                })
        
        message = {
            "type": "game_state",
            "data": asdict(self.game_state),
            "server_settings": {"min_bet": self.min_bet, "max_multiplier": self.max_multiplier},
            "online_count": len(self.players),
            "active_players": active_players
        }
        
        # Отправляем ВСЕМ (broadcast)
        await sio.emit('message', message)
        
        logger.debug(f"Broadcast: {len(active_players)} ставок, {len(self.players)} игроков")

    async def game_loop(self):
        while True:
            try:
                if len(self.players) > 0 and self.game_state.state == "waiting":
                    has_bets = any(player.has_bet for player in self.players.values())
                    if has_bets or (time.time() - self.last_round_time >= 30):
                        await self.start_countdown()
                        self.last_round_time = time.time()

                await asyncio.sleep(1)

            except Exception as e:
                logger.error(f"Ошибка в game_loop: {e}")
                await asyncio.sleep(5)


server = LuckyJetServer()


@sio.event
async def connect(sid, environ):
    logger.info(f"Клиент подключился: {sid}")
    server.connected_clients.add(sid)


@sio.event
async def disconnect(sid):
    logger.info(f"Клиент отключился: {sid}")
    await server.unregister_player(sid)


@sio.event
async def message(sid, data):
    try:
        logger.info(f"Получено сообщение от {sid}: {data}")

        action = data.get("action")

        if action == "telegram_login":
            result = await server.telegram_login(data.get("auth_data", {}))
            if result["success"]:
                player_id = await server.register_player(sid, result["user_data"], result["session_token"])
                result["player_id"] = player_id

            await sio.emit('message', {
                "type": "telegram_login_result",
                "result": result
            }, room=sid)
            return

        if action == "session_login":
            session_token = data.get("session_token", "")
            user_data = await server.get_user_by_session(session_token)
            if user_data:
                player_id = await server.register_player(sid, user_data, session_token)
                result = {
                    "success": True,
                    "message": "Автоматический вход выполнен",
                    "session_token": session_token,
                    "user_data": user_data,
                    "player_id": player_id
                }
            else:
                result = {"success": False, "message": "Недействительная сессия"}

            await sio.emit('message', {
                "type": "session_login_result",
                "result": result
            }, room=sid)
            return

        player_id = data.get("player_id")
        if not player_id or player_id not in server.players:
            await sio.emit('message', {
                "type": "error",
                "message": "Неверный ID игрока"
            }, room=sid)
            return

        if action == "place_bet":
            result = await server.place_bet(
                player_id,
                float(data.get("bet_amount", 0)),
                float(data.get("auto_cashout", 0.0))
            )
            await sio.emit('message', {
                "type": "bet_result",
                "result": result
            }, room=sid)

        elif action == "cashout":
            result = await server.cashout(player_id)
            await sio.emit('message', {
                "type": "cashout_result",
                "result": result
            }, room=sid)

        elif action == "connect_wallet":
            wallet_data = data.get("wallet_data", {})
            wallet_address = wallet_data.get("address", "")

            if wallet_address:
                result = await server.connect_wallet(player_id, wallet_address)
                await sio.emit('message', {
                    "type": "wallet_connect_result",
                    "result": result
                }, room=sid)
            else:
                await sio.emit('message', {
                    "type": "wallet_connect_result",
                    "result": {"success": False, "message": "Адрес кошелька не указан"}
                }, room=sid)

        elif action == "open_case":
            case_type = data.get("case_type", "starter")
            price = float(data.get("price", 0.1))

            result = await server.open_case(player_id, case_type, price)
            await sio.emit('message', {
                "type": "case_open_result",
                "result": result
            }, room=sid)

        elif action == "get_case_items":
            case_type = data.get("case_type", "starter")
            result = await server.get_case_items_preview(case_type)
            await sio.emit('message', {
                "type": "case_items_result",
                "result": result
            }, room=sid)

        elif action == "get_inventory":
            result = await server.get_inventory(player_id)
            await sio.emit('message', {
                "type": "inventory_result",
                "result": result
            }, room=sid)

        elif action == "sell_item":
            item_id = data.get("item_id")
            result = await server.sell_item(player_id, item_id)
            await sio.emit('message', {
                "type": "sell_item_result",
                "result": result
            }, room=sid)

        elif action == "sell_all_items":
            result = await server.sell_all_items(player_id)
            await sio.emit('message', {
                "type": "sell_all_result",
                "result": result
            }, room=sid)

    except Exception as e:
        logger.error(f"Ошибка обработки сообщения: {e}", exc_info=True)
        await sio.emit('message', {
            "type": "error",
            "message": f"Внутренняя ошибка сервера: {str(e)}"
        }, room=sid)


app = web.Application()
sio.attach(app)


async def handle_index(request):
    templates_dir = Path("templates")
    index_file = templates_dir / "index.html"
    if index_file.exists():
        with open(index_file, 'r', encoding='utf-8') as f:
            content = f.read()
        return web.Response(text=content, content_type='text/html', charset='utf-8')
    return web.Response(text="HTML файл не найден!", status=404)


async def handle_static(request):
    filename = request.match_info['filename']
    static_dir = Path("static")
    file_path = static_dir / filename
    if file_path.exists() and file_path.is_file():
        with open(file_path, 'rb') as f:
            content = f.read()
        content_type = 'application/octet-stream'
        if filename.endswith('.css'):
            content_type = 'text/css'
        elif filename.endswith('.js'):
            content_type = 'application/javascript'
        elif filename.endswith('.png'):
            content_type = 'image/png'
        return web.Response(body=content, content_type=content_type)
    return web.Response(text="Файл не найден", status=404)


async def handle_images(request):
    folder = request.match_info.get('folder', '')
    filename = request.match_info.get('filename', '')

    images_dir = Path("images")
    file_path = images_dir / folder / filename

    if file_path.exists() and file_path.is_file():
        with open(file_path, 'rb') as f:
            content = f.read()

        content_type = 'image/png'
        if filename.endswith('.jpg') or filename.endswith('.jpeg'):
            content_type = 'image/jpeg'
        elif filename.endswith('.gif'):
            content_type = 'image/gif'
        elif filename.endswith('.tgs'):
            content_type = 'application/x-tgsticker'

        return web.Response(body=content, content_type=content_type)

    default_path = Path("static") / "images" / "default.png"
    if default_path.exists():
        with open(default_path, 'rb') as f:
            content = f.read()
        return web.Response(body=content, content_type='image/png')

    return web.Response(text="Изображение не найдено", status=404)


async def handle_case_images(request):
    """Обработчик изображений кейсов"""
    case_type = request.match_info.get('case_type', '')
    filename = request.match_info.get('filename', '')

    case_images_dir = Path("images") / "cases" / case_type
    file_path = case_images_dir / filename

    if file_path.exists() and file_path.is_file():
        with open(file_path, 'rb') as f:
            content = f.read()

        content_type = 'image/png'
        if filename.endswith('.jpg') or filename.endswith('.jpeg'):
            content_type = 'image/jpeg'
        elif filename.endswith('.gif'):
            content_type = 'image/gif'
        elif filename.endswith('.webp'):
            content_type = 'image/webp'
        elif filename.endswith('.tgs'):
            content_type = 'application/x-tgsticker'

        return web.Response(body=content, content_type=content_type)

    # Если изображение не найдено, возвращаем 404
    return web.Response(text="Изображение кейса не найдено", status=404)


async def handle_manifest(request):
    manifest = {
        "url": SERVER_URL,
        "name": "Lucky Jet",
        "iconUrl": f"{SERVER_URL}/static/icon.png",
        "termsOfUseUrl": f"{SERVER_URL}/terms",
        "privacyPolicyUrl": f"{SERVER_URL}/privacy"
    }
    return web.json_response(manifest)


app.router.add_get('/', handle_index)
app.router.add_get('/static/images/cases/{case_type}/{filename}', handle_case_images)  # Более специфичный маршрут первым
app.router.add_get('/static/images/{folder}/{filename}', handle_images)
app.router.add_get('/static/{filename}', handle_static)
app.router.add_get("/tonconnect-manifest.json", handle_manifest)

cors = aiohttp_cors.setup(app, defaults={
    "*": aiohttp_cors.ResourceOptions(
        allow_credentials=True,
        expose_headers="*",
        allow_headers="*",
        allow_methods=["GET", "POST", "OPTIONS"]
    )
})

for route in list(app.router.routes()):
    if not str(route.resource).startswith('<PlainResource  /socket.io'):
        cors.add(route)


async def main():
    # Создаем папки если их нет
    Path("images").mkdir(exist_ok=True)
    for folder in ["1", "2", "5", "10", "50", "100"]:
        Path(f"images/{folder}").mkdir(exist_ok=True)
    
    # Создаем папки для изображений кейсов
    Path("images/cases").mkdir(exist_ok=True)
    for case_type in ["starter", "premium", "gold", "jackpot", "mega", "ultimate"]:
        Path(f"images/cases/{case_type}").mkdir(exist_ok=True)

    Path("static/images").mkdir(parents=True, exist_ok=True)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', 40144)
    await site.start()
    logger.info(f"Сервер запущен на http://localhost:40144")
    logger.info(f"Публичный URL: {SERVER_URL}")
    logger.info("Структура папок для изображений создана:")
    logger.info("  images/1/    - для предметов стоимостью 1 TON")
    logger.info("  images/2/    - для предметов стоимостью 2 TON")
    logger.info("  images/5/    - для предметов стоимостью 5 TON")
    logger.info("  images/10/   - для предметов стоимостью 10 TON")
    logger.info("  images/50/   - для предметов стоимостью 50 TON")
    logger.info("  images/100/  - для предметов стоимостью 100 TON")
    logger.info("  images/cases/starter/  - изображения Starter кейса")
    logger.info("  images/cases/premium/  - изображения Premium кейса")
    logger.info("  images/cases/gold/     - изображения Gold кейса")
    logger.info("  images/cases/jackpot/  - изображения Jackpot кейса")
    logger.info("  images/cases/mega/     - изображения Mega кейса")
    logger.info("  images/cases/ultimate/ - изображения Ultimate кейса")

    asyncio.create_task(server.game_loop())

    try:
        await asyncio.Future()
    except KeyboardInterrupt:
        server.db.close()
        await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())