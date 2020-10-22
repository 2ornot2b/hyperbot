const lichessBotName = process.env.BOT_NAME || "chesshyperbot"
const engineThreads = process.env.ENGINE_THREADS || "1"
const engineMoveOverhead = process.env.ENGINE_MOVE_OVERHEAD || "500"
const generalTimeout = parseInt(process.env.GENERAL_TIMEOUT || "15")
const queryPlayingInterval = parseInt(process.env.QUERY_PLAYING_INTERVAL || "60")
const challengeInterval = parseInt(process.env.CHALLENGE_INTERVAL || "30")
const challengeTimeout = parseInt(process.env.CHALLENGE_TIMEOUT || "60")

const path = require('path')
const express = require('express')
const app = express()
const port = process.env.PORT || 3000

const fetch = require('node-fetch')

const { streamNdjson } = require('@easychessanimations/fetchutils')
const lichessUtils = require("@easychessanimations/lichessutils")

const UciEngine = require('@easychessanimations/uci')

const engine = new UciEngine(path.join(__dirname, 'stockfish12'))

let playingGameId = null

const { sseMiddleware, setupStream, ssesend, TICK_INTERVAL } = require('@easychessanimations/sse')

app.use(sseMiddleware)

setupStream(app)

function logPage(content){
    console.log(content)

    ssesend({
        kind: "logPage",
        content: content
    })
}

const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL
const KEEP_ALIVE_INTERVAL = parseInt(process.env.KEEP_ALIVE_INTERVAL || "5")

const possibleOpeningMoves = ["e2e4", "d2d4", "c2c4", "g1f3", "e2e3"]

const possibleOpeningResponses = {
    "e2e4": ["e7e6", "e7e5", "c7c5", "c7c6", "g8f6", "g7g6", "b7b6", "d7d5"],
    "d2d4": ["e7e6", "e7e5", "c7c5", "c7c6", "g8f6", "d7d5"],
    "c2c4": ["e7e6", "e7e5", "c7c5", "c7c6", "g8f6"],
    "g1f3": ["d7d5", "d7d6", "c7c5", "g8f6"],
    "e2e3": ["e7e5", "d7d6", "c7c5", "g8f6"]
}

function makeMove(gameId, state, moves){
    if(gameId != playingGameId){
        logPage(`refused to make move for invalid game ${gameId} ( playing : ${playingGameId} )`)
        return
    }

    logPage(`engine thinking with ${engineThreads} thread(s) and overhead ${engineMoveOverhead} on ${gameId}, ${moves}`)

    engine.logProcessLine = true

    let enginePromise = engine
        .setoption("Threads", engineThreads)
        .setoption("Move Overhead", engineMoveOverhead)
        .position('startpos', moves)
        .gothen({ wtime: state.wtime, winc: state.winc, btime: state.btime, binc: state.binc })

    if(moves.length == 0){                    
        let randomOpeningMove = possibleOpeningMoves[Math.floor(Math.random() * possibleOpeningMoves.length)]
        enginePromise = Promise.resolve({
            bestmove: randomOpeningMove,
            random: true
        })
    }

    if(moves.length == 1){                    
        let responses = possibleOpeningResponses[moves[0]]

        if(responses){
            let randomOpeningResponse = responses[Math.floor(Math.random() * responses.length)]
            enginePromise = Promise.resolve({
                bestmove: randomOpeningResponse,
                random: true
            })
        }                    
    }
    
    enginePromise.then(result => {
        let bestmove = result.bestmove

        let score = {unit: "none", value: "none"}

        try{
            scoreTemp = result.depthInfos[result.depthInfos.length - 1].score
            if(scoreTemp) score = scoreTemp
        }catch(err){console.log(err)}

        let logMsg = `bestmove: ${bestmove}, source: ${result.random ? "random":"engine"}, score unit: ${score.unit}, score value: ${score.value}`

        logPage(logMsg)

        lichessUtils.postApi({
            url: lichessUtils.makeBotMoveUrl(gameId, bestmove), log: true, token: process.env.TOKEN,
            callback: content => {
                logPage(`move ack: ${content}`)
                if(content.match(/error/)){
                    logPage(`retry move for ${gameId} ${moves}`)

                    makeMove(gameId, state, moves)
                }
            }
        })

        if(result.ponder){
            console.log(`start pondering on ${result.ponder}`)
            engine.logProcessLine = true

            engine            
            .position('startpos', moves.concat([bestmove, result.ponder]))
            .go({ wtime: state.wtime, winc: state.winc, btime: state.btime, binc: state.binc, ponder: true })
        }
    })
}

app.use('/', express.static(__dirname))

app.get('/', (req, res) => {
    res.send(`
    <!doctype html>
    <html>
        <head>
            <title>Hyper Bot</title>
            <style>
            p {
                max-width: 700px;
                background-color: #eee;
                padding: 6px;
                padding-left: 12px;
                border-style: solid;
                border-width: 1px;
                border-color: #aaa;
                border-radius: 15px;
            }
            body {
                padding-left: 20px;
            }
            </style>
            <script src="https://unpkg.com/@easychessanimations/sse@1.0.6/lib/sseclient.js"></script>
        </head>
        <body>
            <h1>Welcome to Hyper Bot !</h1>            
            <p><a href="https://lichess.org/@/${lichessBotName}" rel="noopener noreferrer" target="_blank">${lichessBotName}</a> is powered by Hyper Bot 
            ( <a href="/chr" rel="noopener noreferrer" target="_blank">challenge random bot by ${lichessBotName}</a> )
            </p>
            <p id="logBestmove"></p>
            <h2>If you want to create your own permanent bot, do the following:</h2>
            <p><a href="https://github.com/join" rel="noopener noreferrer" target="_blank">Sign up to GitHub</a>
            <p>With your GitHub account visit <a href="https://github.com/hyperchessbot/hyperbot" rel="noopener noreferrer" target="_blank">hyperchessbot repo</a>, then click on Fork.
            <p><a href="https://signup.heroku.com/" rel="noopener noreferrer" target="_blank">Sign up to Heroku</a>
            <p>At Heroku create a new app using New / Create new app.</p>
            <p>In the app's dashboard go to the Deploy tab. Use the GitHub button to connect the app to your forked repo. You need to deploy the master branch. Enable Automatic Deploys and press Deploy Branch, for the initial deploy.</p>
            <p>Create an API access token with your BOT account ( should have scopes Read incoming challenges / Create, accept, decline challenges / Play games with the bot API ) and in Heroku Settings / Reveal Config Vars create a new variable TOKEN and set its value to your newly created access token and also create a variable BOT_NAME and set its value to your bot's username.
            <p>Congratulations, you have an up and running lichess bot.</p>
            <h2>Install the bot locally:</h2>
            <p><a href="https://gitpod.io#https://github.com/hyperchessbot/hyperbot" rel="noopener noreferrer" target="_blank">Open the project's gitpod terminal</a></p>
            <p>npm install</p>
            <p>export TOKEN={BOT API token}</p>
            <p>export BOT_NAME={BOT username}</p>
            <p>node server.js</p>
            <h2>Other config env vars:</h2>
            <p>GENERAL_TIMEOUT : for event streams in seconds ( default : 15 )</p>
            <p>ENGINE_THREADS : engine Threads option ( default : 1 )</p>
            <p>ENGINE_MOVE_OVERHEAD : engine Move Overhead option in milliseconds ( default : 500 )</p>
            <script>            
            function processSource(blob){
                if(blob.kind == "tick"){                    
                    if(isFirstSourceTick) console.log("stream started ticking")
                }

                if(blob.kind == "logPage"){
                    let content = blob.content

                    console.log(content)

                    if(content.match(/^bestmove/)) document.getElementById("logBestmove").innerHTML = content
                }
            }

            setupSource(processSource, ${TICK_INTERVAL})    
            </script>
        </body>
    </html>
    `)  
})

function playGame(gameId){
    logPage(`playing game: ${gameId}`)

    setTimeout(_=>lichessUtils.gameChat(gameId, "all", `${lichessBotName} running on https://github.com/hyperchessbot/hyperbot`), 2000)
    setTimeout(_=>lichessUtils.gameChat(gameId, "all", `Good luck !`), 4000)

    playingGameId = gameId

    let botWhite

    streamNdjson({url: lichessUtils.streamBotGameUrl(gameId), token: process.env.TOKEN, timeout: generalTimeout, timeoutCallback: _=>{
        logPage(`game ${gameId} timed out ( playing : ${playingGameId} )`)
        
        if(playingGameId == gameId) playGame(gameId)
    }, callback: blob => {        
        if(blob.type == "gameFull"){                
            botWhite = blob.white.name == lichessBotName
        }

        if(blob.type != "chatLine"){                
            let moves = []

            let state = blob.type == "gameFull" ? blob.state : blob

            if(state.moves){
                moves = state.moves.split(" ")
            }

            let whiteMoves = (moves.length % 2) == 0
            let botTurn = (whiteMoves && botWhite) || ((!whiteMoves) && (!botWhite))

            logPage(`bot turn: ${botTurn}`)

            if(botTurn){
                try{
                    makeMove(gameId, state, moves)
                }catch(err){console.log(err)}
            }
        }     
    }})
}

function streamEvents(){
    streamNdjson({url: lichessUtils.streamEventsUrl, token: process.env.TOKEN, timeout: generalTimeout, timeoutCallback: _=>{
        logPage(`event stream timed out`)

        streamEvents()
    }, callback: blob => {        
        if(blob.type == "challenge"){
            let challenge = blob.challenge
            let challengeId = challenge.id

            if(playingGameId){
                logPage(`can't accept challenge ${challengeId}, already playing`)
            }else if(challenge.speed == "correspondence"){
                logPage(`can't accept challenge ${challengeId}, no correspondence`)
            }else if(challenge.variant.key != "standard"){
                logPage(`can't accept challenge ${challengeId}, non standard`)
            }else{
                lichessUtils.postApi({
                    url: lichessUtils.acceptChallengeUrl(challengeId), log: true, token: process.env.TOKEN,
                    callback: content => logPage(`accept response: ${content}`)
                })
            }
        }

        if(blob.type == "gameStart"){                
            let gameId = blob.game.id

            if(playingGameId){
                logPage(`can't start new game ${gameId}, already playing`)
            }else{
                playGame(gameId)
            }                    
        }

        if(blob.type == "gameFinish"){                
            let gameId = blob.game.id

            if(gameId == playingGameId){
                playingGameId = null

                logPage(`game ${gameId} terminated ( playing : ${playingGameId} )`)

                setTimeout(_=>lichessUtils.gameChat(gameId, "all", `Good game !`), 2000)
            }
        }         
    }})
}

function challengeBot(bot){
    return new Promise(resolve=>{
        lichessUtils.postApi({
            url: lichessUtils.challengeUrl(bot), log: true, token: process.env.TOKEN,
            body: `rated=${Math.random()>0.5?"true":"false"}&clock.limit=${60 * (Math.floor(Math.random() * 5) + 1)}&clock.increment=0`,
            contentType: "application/x-www-form-urlencoded",
            callback: content => {
                logPage(`challenge response: ${content}`)
                resolve(content)
            }
        })
    })    
}

function challengeRandomBot(){
    return new Promise(resolve=>{
        lichessUtils.getOnlineBots().then(bots=>{
            bots = bots.filter(bot=>bot!=lichessBotName)
            if(bots.length > 0){
                let bot = bots[Math.floor(Math.random()*bots.length)]

                logPage(`challenging ${bot}`)

                challengeBot(bot).then(content=>{
                    resolve(`Challenged <b style="color:#070">${bot}</b> with response <i style="color:#007">${content || "none"}</i> .`)
                })
            }
        })
    })    
}

app.get('/chr', (req, res) => {
    challengeRandomBot().then(result=>res.send(result))
})

app.listen(port, _ => {
    console.log(`Hyperbot listening on port ${port} !`)

    if(KEEP_ALIVE_URL){
        console.log(`keep alive interval: ${KEEP_ALIVE_INTERVAL} , url: ${KEEP_ALIVE_URL}`)

        setInterval(_=>{
            let hours = new Date().getHours()
            if((hours > 5)&&(hours<23)){
                console.log(`hours ok: ${hours}, keep alive`)
                fetch(KEEP_ALIVE_URL)
            }        
        }, KEEP_ALIVE_INTERVAL * 60 * 1000)
    }

    streamEvents()

    setInterval(_=>{
        fetch(`https://lichess.org/api/user/${lichessBotName}`).then(response=>response.text().then(content=>{
            try{
                let blob = JSON.parse(content)

                let playing = blob.count.playing

                logPage(`playing: ${playing}`)

                if(!playing){
                    if(playingGameId){
                        logPage(`inconsistent playing information, resetting playing game id`)

                        playingGameId = null
                    }
                }
            }catch(err){console.log(err)}
        }))
    }, queryPlayingInterval * 1000)

    let lastPlayedAt = 0
    setInterval(_=>{
        if(playingGameId){
            lastPlayedAt = new Date().getTime()
        }else{
            if((new Date().getTime() - lastPlayedAt) > challengeTimeout * 60 * 1000){
                console.log(`idle timed out`)
                challengeRandomBot()
            }
        }
    }, challengeInterval * 60 * 1000)
})
