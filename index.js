const {
    default: makeWASocket,
    MessageType,
    MessageOptions,
    Mimetype,
    DisconnectReason,
    BufferJSON,
    AnyMessageContent,
    delay,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeCacheableSignalKeyStore,
    makeInMemoryStore,
    MessageRetryMap,
    useMultiFileAuthState,
    msgRetryCounterMap,
  } = require("@whiskeysockets/baileys");
  
  const log = (pino = require("pino"));
  const { session } = { session: "session_auth_info" };
  const { Boom } = require("@hapi/boom");
  const path = require("path");
  const fs = require("fs");
  const express = require("express");
  const fileUpload = require("express-fileupload");
  const cors = require("cors");
  const bodyParser = require("body-parser");
  const app = require("express")();
  // enable files upload
  app.use(
    fileUpload({
      createParentPath: true,
    })
  );
  
  app.use(cors());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  const server = require("http").createServer(app);
  const io = require("socket.io")(server);
  const port = process.env.PORT || 8000;
  const qrcode = require("qrcode");
  
  app.use("/assets", express.static(__dirname + "/client/assets"));
  
  app.get("/scan", (req, res) => {
    res.sendFile("./client/index.html", {
      root: __dirname,
    });
  });
  
  app.get("/", (req, res) => {
    res.send("server working");
  });
  
  let sock;
  let qrDinamic;
  let soket;
  
  function deleteSessionFolder() {
    const sessionPath = path.join(__dirname, 'session_auth_info');
  
    if (fs.existsSync(sessionPath)) {
      // Leer los contenidos del directorio
      fs.readdir(sessionPath, (err, files) => {
        if (err) {
          console.log('Error reading directory:', err);
          return;
        }
  
        // Eliminar todos los archivos y subdirectorios
        files.forEach(file => {
          const filePath = path.join(sessionPath, file);
  
          fs.stat(filePath, (err, stat) => {
            if (err) {
              console.log('Error getting file stats:', err);
              return;
            }
  
            if (stat.isDirectory()) {
              fs.rmdir(filePath, { recursive: true }, (err) => {
                if (err) {
                  console.log('Error removing directory:', err);
                }
              });
            } else {
              fs.unlink(filePath, (err) => {
                if (err) {
                  console.log('Error removing file:', err);
                }
              });
            }
          });
        });
  
        // Eliminar el directorio principal después de vaciarlo
        fs.rmdir(sessionPath, (err) => {
          if (err) {
            console.log('Error removing directory:', err);
          } else {
            console.log('Carpeta de sesión eliminada');
          }
        });
      });
    }
  }
  
  
  async function connectToWhatsApp() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState("session_auth_info");
  
      sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: log({ level: "silent" }),
      });
  
      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        qrDinamic = qr;
        if (connection === "close") {
          const reason = new Boom(lastDisconnect.error).output.statusCode;
          console.log(`Conexión cerrada: ${reason}`);
          if (reason === DisconnectReason.loggedOut) {
            console.log("Dispositivo cerrado, escanea el código QR de nuevo.");
            deleteSessionFolder();
            connectToWhatsApp(); // Intenta reconectar
          } else if ([DisconnectReason.connectionLost, DisconnectReason.connectionClosed, DisconnectReason.connectionReplaced].includes(reason)) {
            console.log("Intentando reconectar...");
            await delay(5000); // Espera antes de intentar reconectar
            connectToWhatsApp();
          } else if (reason === DisconnectReason.restartRequired) {
            console.log("Se requiere reinicio, reiniciando...");
            await delay(5000); // Espera antes de reiniciar
            connectToWhatsApp();
          } else if (reason === DisconnectReason.timedOut) {
            console.log("Se agotó el tiempo de conexión, reconectando...");
            await delay(5000); // Espera antes de intentar reconectar
            connectToWhatsApp();
          } else {
            console.error(`Motivo de desconexión desconocido: ${reason}`);
            sock.end();
          }
        } else if (connection === "open") {
          console.log("Conexión abierta");
          updateQR("connected");
        }
      });
  
      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        try {
          if (type === "notify" && !messages[0]?.key.fromMe) {
            const captureMessage = messages[0]?.message?.conversation;
            const numberWa = messages[0]?.key?.remoteJid;
            const compareMessage = captureMessage.toLocaleLowerCase();
  
            if (compareMessage === "ping") {
              await sock.sendMessage(numberWa, { text: "pong" }, { quoted: messages[0] });
            } else {
              await sock.sendMessage(numberWa, { text: "Hola! Mi nombre es Cinthia, ¿Cómo puedo ayudarte? 😊" }, { quoted: messages[0] });
            }
          }
        } catch (error) {
          console.error("Error en el manejo de mensajes:", error);
        }
      });
  
      sock.ev.on("creds.update", saveCreds);
  
    } catch (err) {
      console.error("Error en la conexión:", err);
      setTimeout(connectToWhatsApp, 5000); // Espera antes de intentar reconectar
    }
  }
  
  const isConnected = () => {
    return sock?.user ? true : false;
  };
  
  app.get("/send-message", async (req, res) => {
    const tempMessage = req.query.message;
    const number = req.query.number;
  
    let numberWA;
    try {
      if (!number) {
        res.status(500).json({
          status: false,
          response: "⚠️ Oh no, Parece que el número no existe!",
        });
      } else {
        numberWA = "505" + number + "@s.whatsapp.net";
     
        if (isConnected()) {
  
         
          const exist = await sock.onWhatsApp(numberWA);
  
          if (exist?.jid || (exist && exist[0]?.jid)) {
            sock
              .sendMessage(exist.jid || exist[0].jid, {
                text: tempMessage,
              })
              .then((result) => {
                res.status(200).json({
                  status: true,
                  response: result,
                });
              })
              .catch((err) => {
                res.status(500).json({
                  status: false,
                  response: err,
                });
              });
          }
        } else {
          res.status(500).json({
            status: false,
            response: "Uh oh, parece que aún no estas conectado",
          });
        }
      }
    } catch (err) {
      res.status(500).send(err);
    }
  });
  
  io.on("connection", async (socket) => {
    soket = socket;
    if (isConnected()) {
      updateQR("connected");
    } else if (qrDinamic) {
      updateQR("qr");
    }
  });
  
  const updateQR = (data) => {
    switch (data) {
      case "qr":
        qrcode.toDataURL(qrDinamic, (err, url) => {
          soket?.emit("qr", url);
          soket?.emit("log", "QR recibido , scan");
        });
        break;
      case "connected":
        soket?.emit("qrstatus", "./assets/check.svg");
        soket?.emit("log", " usaario conectado");
        const { id, name } = sock?.user;
        var userinfo = id + " " + name;
        soket?.emit("user", userinfo);
  
        break;
      case "loading":
        soket?.emit("qrstatus", "./assets/loader.gif");
        soket?.emit("log", "Cargando ....");
  
        break;
      default:
        break;
    }
  };
  
  connectToWhatsApp().catch((err) => console.log("unexpected error: " + err)); // catch any errors
  server.listen(port, () => {
    console.log("Server Run Port : " + port);
  });
  