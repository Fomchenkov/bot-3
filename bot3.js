const url = require("url");
const path = require("path");
const fs = require("fs");
const request = require("request");
const telebot = require("telebot");
const mysql = require("mysql");
const data = require("./data");

const TOKEN = "340446177:AAH9wsRsNeBZhfRn3oOVBheHEt8AOcddetw";
const bot = new telebot(TOKEN);

const dbhost = "localhost";
const dbuser = "slava";
const dbpass = "foma";
const dbname = "telegrambot3";
const dbport = 3306;

const inProcess = {};
const users_steps = "users_steps.json";
const dirForUsers = "DataBase";
const stepsTable = "users_steps";
const userDataTablePrefix = "_user_";
const adminAnswersTablePrefix = "_answers_";


/**
* Скачать файл по заданному uri
* @param uri {string} - путь для скачивания файла
* @param filename {string} - название файла на нашем сервере
* @param callback {function} - функция обратного вызова
*/
function download(uri, filename, callback) {
	request.head(uri, (err, res, body) => {
		request(uri).pipe(fs.createWriteStream(filename)).on("close", callback);
	});
}


/**
* Создает из строки массив для клавиатуры бота
* @param str {string} - строка вида "ключ1;ключ2;ключ3"
* @rerurn {array} - двухмерный массив типа [["ключ1"], ["ключ2"], ["ключ3"]]
*/
function buildKeyboard(str) {
	let keyboard = [];
	let strArr = str.split(";");
	for (let i = 0; i < strArr.length; i++) {
		keyboard.push([strArr[i]]);
	}
	console.log(keyboard);
	return bot.keyboard(keyboard, { resize: true });
}

/**
* Настроить step пользовеля
* @param userid {int} - id пользователя
* @param step {string} - новый шаг пользователя
*/
function setUserStep(userid, step) {
	return new Promise((resolve, reject) => {
		fs.readFile(users_steps, (err, data) => {
			if (err) throw err;
			json = JSON.parse(data);
			json[userid] = step;
			data = JSON.stringify(json);
			fs.writeFile(users_steps, data, (err) => {
				if (err) throw err;
				console.log(data);
				resolve();
			});
		});
	});
}

/**
* Найти step пользователя
* @param {userid} - id пользователя telegram
* @return {string} - step пользователя
*/
function getUserStep(userid) {
	return new Promise((resolve, reject) => {
		fs.readFile(users_steps, (err, data) => {
			if (err) throw err;
			json = JSON.parse(data);
			let step = json[userid];
			if (! step) step = "0";
			resolve(step);
		});
	});
}

/**
* Вставить данные от пользователя в базу данных
* @param question {string} - вопрос для вставки
* @param answer {string} - ответ для вставки
* @param connection {connection} - объект соединения с базой данных
*/
function insertUserAnswerToDataBase(question, answer, connection, msg) {
	return new Promise((resolve, reject) => {
		let sql = `INSERT INTO  ${userDataTablePrefix}${msg.from.id} 
		(question, answer) VALUES ('${question}', '${answer}')`;
		connection.query(sql, (err, res) => {
			if (err) throw err;
			resolve(res);
		});
	});
}

/**
* Получить объекты из data, соответствующие по path переданному step
* @param step {string} - step юзера
* @return {array} - массив из объектов
*/
function getCurrentDataByStep(step) {
	let arr = [];
	for (let i = 0; i < data.length; i++) {
		if (data[i].path == step) {
			arr.push(data[i]);
		}
	}
	console.log(arr);
	return arr;
}

/**
* Найти массив с вопросами
* @param step {string} - step юзера
* @return {array} - массив с ответами
*/
function findQuestionsArray(step) {
	let arr = [];
	// Выбрать нужные объекты сo step
	for (let i = 0; i < data.length; i++) {
		if (data[i].path == step) {
			arr.push(data[i]);
		}
	}
	return arr;
}

/**
* Получить данные из keyboardText в виде строки
* @param step {string} - step для отбора
* @retrun {string} - строка вида "ключ1;ключ2;ключ3"
*/
function getKeyboardTextAsString(step) {
	let arr = getCurrentDataByStep(step);
	let str = "";
	for (let i = 0; i < arr.length; i++) {
		if (arr[i].keyboardText) {
			str += arr[i].keyboardText + ";";
		}
	}
	if (str == "") return "***"
	// Убрать последний ";"
	return str.substring(0, str.length-1);
}

/**
* Получить последний вопрос, заданный юзеру
* @param userid {int} - id юзера в telegram
* @return {string} - последний вопрос
*/
function getLastQuestion(userid) {
	return new Promise((resolve, reject) => {
		getUserStep(userid).then(step => {
			let question;
			try { question = findQuestionsArray(step)[0].text; }
			catch (e) {}
			if (! question) question = "";
			console.log("Last question is:", question);
			resolve(question);
		});
	});
}

/**
* Получить следующий step для юзера
* @param step {string} - текущий step юзера
* @return {string} - следующий step юзера
*/
function getNextStep(step) {
	return new Promise((resolve, reject) => {
		let arr = findQuestionsArray(step);
		console.log(arr);
		let newStep = null;
		for (let i = 0; i < arr.length; i++) {
			if (arr[i].path == step) {
				newStep = arr[i].step;
				console.log(newStep);
				resolve(newStep);
			}
		}
	});
}


// Отобразаить исходные разделы
bot.on("/start", msg => {
	if (inProcess[msg.from.id]) { console.log("Access closed", inProcess); return; } 
	else { inProcess[msg.from.id] = "ok"; console.log(inProcess); }

	const connection = mysql.createConnection({
		host: dbhost, user: dbuser,password: dbpass, 
		database: dbname, port: dbport
	});
	connection.connect();
	try { fs.mkdirSync(`${dirForUsers}/${msg.from.username}`); }
	catch (e) {}

	// Создать таблицу для ответов админа пользователю
	let sql = `CREATE TABLE IF NOT EXISTS 
		${adminAnswersTablePrefix}${msg.from.id} (
		ID int NOT NULL AUTO_INCREMENT,
		question TEXT NOT NULL,
		answer TEXT NOT NULL,
		PRIMARY KEY (ID))`;
	connection.query(sql, (err, res) => {
		if (err) throw err;

		// Создать таблицу для пользователя, если требуется
		sql = `CREATE TABLE IF NOT EXISTS 
			${userDataTablePrefix}${msg.from.id} (
			ID int NOT NULL AUTO_INCREMENT,
			question TEXT NOT NULL,
			answer TEXT NOT NULL,
			PRIMARY KEY (ID))`;
		connection.query(sql, (err, res) => {
			if (err) throw err;

			// Path для вывода
			let step = "0";
			setUserStep(msg.from.id, step).then(() => {
				let str = getKeyboardTextAsString(step);
				let markup = buildKeyboard(str);
				let text = "Выберите раздел";
				bot.sendMessage(msg.from.id, text, { markup });

				delete inProcess[msg.from.id];
				console.log(inProcess);
				connection.end();
			});
		});
	});
});

// При отправке текстового сообщения
bot.on("text", msg => {
	if (Array.isArray(msg.entities)) {
		if (msg.entities[0].type == "bot_command") return;
	}

	getUserStep(msg.from.id).then(step => {
		// Проверка на "Мои ответы"
		if (step == "0" && msg.text == "3. Ответы на мои вопросы") {
			if (inProcess[msg.from.id]) { 
				console.log("Access closed", inProcess); return; } 
			else { inProcess[msg.from.id] = "ok"; console.log(inProcess); }

			const connection = mysql.createConnection({
				host: dbhost, user: dbuser,password: dbpass, 
				database: dbname, port: dbport
			});
			connection.connect();
			let sql = `SELECT * FROM ${adminAnswersTablePrefix}${msg.from.id}`;
			connection.query(sql, (err, res) => {
				if (err) throw err;
				// Отправить выбранные сообщения
				let text = "";
				for (let i = 0; i < res.length; i++) {
					text += "*Ваш вопрос*\n" + res[i].question + "\n";
					text += "*Ответ админа*\n" + res[i].answer;
					text += "\n\n";
				}
				if (! text) {
					text = "Ответов на ваши вопросы нет.";
					text += "\nЧто бы перейти в главное меню, отправьте /start";
				}
				bot.sendMessage(msg.from.id, text, { parse: "Markdown"});
				delete inProcess[msg.from.id];
				console.log(inProcess);
				connection.end();
			});
		} else {
			let arr = findQuestionsArray(step);
			console.log("Current array is:", arr);
			for (let i = 0; i < arr.length; i++) {
				// Еcли есть writable
				if (arr[i].writable) {
					// Записать ответ в базу
					console.log("DataBase used");
					getLastQuestion(msg.from.id).then(question => {
						let answer = msg.text;
						if (inProcess[msg.from.id]) { 
							console.log("Access closed", inProcess); return; } 
						else { inProcess[msg.from.id] = "ok"; console.log(inProcess); }

						const connection = mysql.createConnection({
							host: dbhost, user: dbuser,password: dbpass, 
							database: dbname, port: dbport
						});
						connection.connect();
						let sql = `INSERT INTO ${userDataTablePrefix}${msg.from.id} 
						(question, answer) VALUES ('${question}', '${answer}')`;
						connection.query(sql, (err, res) => {
							if (err) throw err;
							console.log("Data INSERT in DataBase");
							delete inProcess[msg.from.id];
							console.log(inProcess);
							connection.end();
							// Plus one step
							setUserStep(msg.from.id, arr[i].step).then(() => {
								getUserStep(msg.from.id).then(step => {
									let str = getKeyboardTextAsString(step);
									console.log(str);
									let markup = buildKeyboard(str);
									let text;
									try { text = getCurrentDataByStep(step)[0].text; }
									catch (e) {}
									if (! text) text = "Выберите категорию";
									bot.sendMessage(msg.from.id, text, { markup });
								});
							});
						});
					});
					return;
				// Если нажата кнопка
				} else if (arr[i].keyboardText == msg.text) {
					setUserStep(msg.from.id, arr[i].step).then(() => {
						getUserStep(msg.from.id).then(step => {
							let str = getKeyboardTextAsString(step);
							console.log(str);
							let markup = buildKeyboard(str);
							let text;
							try { text = getCurrentDataByStep(step)[0].text; }
							catch (e) {}
							if (! text) text = "Выберите категорию";
							bot.sendMessage(msg.from.id, text, { markup });
						});
					});
					return;
				} else if (arr[i].redirectToMenu) {
					// Номер раздела меню
					let newStep = step[0];
					setUserStep(msg.from.id, newStep).then(() => {
						let str = getKeyboardTextAsString(newStep);
						console.log(str);
						let markup = buildKeyboard(str);
						let text = "Пожалуйста, выберите категорию";
						bot.sendMessage(msg.from.id, text, { markup });
					});
					return;
				}
			}


			// Нет ни ответа, ни writable
			let str = getKeyboardTextAsString(step);
			console.log(str);
			let markup = buildKeyboard(str);
			let text = "Пожалуйста, выберите категорию";
			console.log("No answer, no writable");
			return bot.sendMessage(msg.from.id, text, { markup });
		}
	});
});

// При отправке фото
bot.on("photo", msg => {
	// Найти фото с наибольшим имеющимся разрешением
	let file_id = "";
	msg.photo.forEach((element, index) => {
		file_id = msg.photo[index].file_id;
	});
	let username = msg.from.username;
	let id = msg.from.id;

	return bot.getFile(file_id).then(res => {
		let file_path = res.file_path;
		let urlToFile = `http://api.telegram.org/file/bot${TOKEN}/${file_path}`;
		console.log("\n", urlToFile, "\n");
		let upload = `./${dirForUsers}/${username}/`;
		let parsed = url.parse(urlToFile);

		getUserStep(id).then(step => {
			getLastQuestion(id).then(question => {
				let data1 = getCurrentDataByStep(step);
				// Если не нужно записывать
				if (! data1[0].writable) {
					console.log("Photo not writable.");
					let str = getKeyboardTextAsString(step);
					console.log(str);
					let markup = buildKeyboard(str);
					let text;
					try { text = getCurrentDataByStep(step)[0].text; }
					catch (e) {}
					if (! text) text = "Выберите категорию";
					bot.sendMessage(msg.from.id, text, { markup });
					return;
				}

				let path1 = data1[0].path;
				// File name to save on sever
				let f = `${upload}photo${path1}.${step}${path.extname(parsed.pathname)}`;
				download(urlToFile, f, () => {});
				let answer = "";
				if (msg.caption) {
					answer += msg.caption + "\n"; 
				}
				answer += `url=\"${f}\"`;

				if (inProcess[msg.from.username]) { 
					console.log("Access closed", inProcess); return; } 
				else { inProcess[msg.from.id] = "ok"; console.log(inProcess); }

				const connection = mysql.createConnection({
					host: dbhost, user: dbuser, password: dbpass, 
					database: dbname, port: dbport
				});
				connection.connect();

				insertUserAnswerToDataBase(question, answer, connection, msg).then(() => {
					delete inProcess[msg.from.id];
					console.log(inProcess);
					connection.end();
					console.log("connection closed!")
					getNextStep(step).then(step => {
						console.log("Next step getted", step);
						setUserStep(msg.from.id, step).then(() => {
							let str = getKeyboardTextAsString(step);
							console.log(str);
							let markup = buildKeyboard(str);
							let text;
							try { text = getCurrentDataByStep(step)[0].text; }
							catch (e) {}
							if (! text) text = "Выберите категорию";
							delete inProcess[msg.from.id];
							console.log(inProcess);
							bot.sendMessage(msg.from.id, text, { markup });
						}).catch(e => console.log(e));
					}).catch(e => console.log("err is:", e));
				});
			});
		});
	});
});

// При первом развертывании создаем папку для пользователей
try { fs.mkdirSync("./" + dirForUsers); } 
catch (e) {}
try { fs.writeFileSync(users_steps, "{}"); }
catch (e) {}

bot.connect();
