var fs = require("fs");
var path = require("path");
var Jimp = require("jimp");
var {Worker, isMainThread, parentPort, workerData} = require("worker_threads");

var {execSync} = require("child_process");
var { lookpath } = require('lookpath');

//TODO: gen palette if mising + optimize memory usage
var palette = require("./palette.json");
var imageSize = palette.imgSize;

var inputPath = "./images/input";
var outPath = "./images/output"; 
var allowedExt = [".png", ".jpg"];

var workerCount = 5;
var workers = [];
var cache = {};

//decompress palette map:
let fullMap = [];
for (let i = 0; i < palette.map.length; i++) {
    let data = palette.map[i];

    let value = data.split(":")[0];
    let start = parseInt(data.split(":")[1].split("->")[0]);
    let end = parseInt(data.split(":")[1].split("->")[1]);

    for (let j = start; j < end; j++) {
        let r = (j >> 16) & 0xff;
        let g = (j >> 8) & 0xff;
        let b = j & 0xff;  
        
        if (fullMap[r] == null)
            fullMap[r] = [];
        if (fullMap[r][g] == null)
            fullMap[r][g] = [];
        if (fullMap[r][g][b] == null)
            fullMap[r][g][b] = [];

        fullMap[r][g][b] = value;
    }
}
palette.map = fullMap;

if (!isMainThread) {
    parentPort.on("message", (message) => {
        switch (message.action) {
            case "process_image":
                processImage(message.data).then(() => {
                    parentPort.postMessage({
                        action: "done",
                        data: message.data
                    });
                });
                break;
        }
    }); 
} else { 
    start();
}

async function start() {
    log(`Loading input images...`);

    if (await lookpath("magick") != null) {
        readDirRecursive(inputPath).filter(file => path.parse(file).base != "__converted__").forEach(file => {
            let parsed = path.parse(file);

            if (!fs.existsSync(path.join(inputPath, "__converted__")))
                fs.mkdirSync(path.join(inputPath, "__converted__"))

            if (!allowedExt.includes(parsed.ext)) {
                let out = execSync(`magick ${file} ${path.join(parsed.dir, parsed.name)}${allowedExt[0]}`);
                
                console.log(`magick ${file} ${path.join(parsed.dir, parsed.name)}${allowedExt[0]}`)
                console.log(out.toString());

                fs.renameSync(file, path.join(inputPath, "__converted__", parsed.base))
            }
        });
    }

    let images = readDirRecursive(inputPath)
        .filter(file => path.parse(file).base != "__converted__")
        .map((file) => path.relative(inputPath, file))
        .filter((file) => allowedExt.includes(path.parse(file).ext));
    let processed = 0;
    let errors = 0;

    if (images.length == 0) {
        end(0, 0);
        return;
    }

    log(`Initializing workers...`);
    for (let i = 0; i < workerCount; i++) {
        let worker = new Worker(__filename, {});

        worker.working = false;
        worker.currTask = {action: null, data: null};
        worker.task = (name, data) => {
            worker.working = true;
            worker.currTask = {action: name, data: data};
            worker.postMessage({action: name, data: data});
        };
        worker.done = () => {worker.currTask = {action: null, data: null}; worker.working = false; }
        workers[i] = worker;

        let checkForEnd = () => {
            for (let j = 0; j < workerCount; j++) {
                if (workers[j].working)
                    return;
            }

            setTimeout(() => end(processed, errors), 1000);
            
        };

        worker.on("error", (err) => {
            if (worker.currTask.action != "process_image")
                return;

            log(`(worker: ${i}) [X]Error while processing ${worker.currTask.data}:`);
            console.log(err);
            errors++;

            if (images.length > 0) {
                let image = images.pop();
                log(`(worker: ${i}) [↺]${image} started processing...`);

                worker.task("process_image", image);
                return;
            }

            worker.done();
            checkForEnd();
        });

        worker.on("message", (message) => {
            switch (message.action) {
                case "log":
                    log(message.data);
                    break;
                    
                case "done":
                    log(`(worker: ${i}) [✓]${message.data} done processing.`)
                    processed++;

                    if (images.length > 0) {
                        let image = images.pop();
                        log(`(worker: ${i}) [↺]${image} started processing...`);

                        worker.task("process_image", image);
                        return;
                    }

                    worker.done();
                    checkForEnd();
                    break;
            }
        });
    }

    for (let i = 0; i < Math.min(workerCount, images.length); i++) {
        let image = images.pop();
        log(`(worker: ${i}) [↺]${image} started processing...`);

        workers[i].task("process_image", image);
    }

}

function end(processed, errors) {
    log(`All(${processed}) images have been processed, Errors: ${errors}.`)

    workers.forEach(worker => worker.terminate());
    // setTimeout(() => process.exit(), 4000);
}

async function processImage(filename) {
    let log = (msg) => parentPort.postMessage({action: "log", data: msg});
    let original = await Jimp.read(path.join(inputPath, filename));

    let data = original.bitmap.data;
    let width = original.bitmap.width;
    let height = original.bitmap.height;

    let textures = [];
    for (let i = 0; i < data.length/4; i++) {
        let r = data[i * 4];
        let g = data[i * 4 + 1];
        let b = data[i * 4 + 2];
        let a = data[i * 4 + 3];

        let filePath = path.join(palette.dir, palette.dict[palette.map[r][g][b]]);
        if (cache[filePath] == null) {
            let buffer = (await Jimp.read(filePath)).bitmap.data;
            cache[filePath] = buffer;

            //TODO: send image to other workers
        }

        textures[i] = {name: filePath, alpha: a};
    }

    let imgData = Buffer.alloc(((width * imageSize) * (height * imageSize))  * 4);
    for (let i = 0; i < imgData.length / 4; i++) {
        let x = i % (width * imageSize);
        let y = Math.floor(i / (width * imageSize));

        let textureX = Math.floor(x / imageSize);
        let textureY = Math.floor(y / imageSize);
        let textureIndex = textureY * width + textureX;
        // log(`${x}, ${y} -> ${textureIndex}`)

        let pixelX = x % imageSize;
        let pixelY = y % imageSize;
        let pixelIndex = (pixelY * imageSize + pixelX);

        let texture = cache[textures[textureIndex].name];
        let alpha = textures[textureIndex].alpha;
        if (alpha == 0) {
            imgData.set([0, 0, 0, 0], i * 4);
            return;
        }

        let r = texture[pixelIndex * 4];
        let g = texture[pixelIndex * 4 + 1];
        let b = texture[pixelIndex * 4 + 2];
        imgData.set([r, g, b, alpha], i * 4);
    }

    let img = new Jimp({data: imgData, width: width * imageSize, height: height * imageSize});

    let parsedPath = path.parse(filename);
    let filePath = path.join(outPath, parsedPath.dir, `${parsedPath.name}.png`);
    let dir = path.parse(filePath).dir;

    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });

    await img.write(filePath);
}



function readDirRecursive(directory, onlyFiles = true) {
    if (!fs.existsSync(directory))
        return [];

    let files = [];
    fs.readdirSync(directory).forEach(file => {
        let filePath = path.join(directory, file);

        if (fs.statSync(filePath).isDirectory()) {
            if (!onlyFiles)
                file.push(filePath);

            files = files.concat(readDirRecursive(filePath));
            return;
        }

        files.push(filePath);
    });

    return files;
}

function log(message) {
    message = message.toString();
    let date = new Date();

    let newLineCount = 0;
    if (message.startsWith(`\n`)) {
        let i = 0;
        while (message[i] == "\n") {
            newLineCount++;
            i++;
        }
    }

    process.stdout.write(`${"\n".repeat(newLineCount)}[${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}] ${message.slice(newLineCount)}\n`);
}