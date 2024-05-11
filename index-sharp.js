var fs = require("fs");
var path = require("path");
var sharp = require("sharp");
var {Worker, isMainThread, parentPort, workerData} = require("worker_threads");

var palette = require("./palette.json");

var inputPath = "./images/input";
var outPath = "./images/output"; 
var allowedExt = [".png"]

var workerCount = 4;
var workers = [];

//Worker only variables
var textureCache = {};

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

function start() {
    log(`Loading input images...`);

    let images = readDirRecursive(inputPath)
        .map((file) => path.relative(inputPath, file))
        .filter((file) => allowedExt.includes(path.parse(file).ext));
    let processed = 0;
    let errors = 0;

    if (images.length == 0)
        end(0, 0);

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

            end(processed, errors);
        };

        worker.on("error", (err) => {
            if (worker.currTask.action != "process_image")
                return;

            log(`(worker: ${i}) [X]Error while processing ${worker.currTask.data}:`);
            console.log(err)
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
    log(`All(${processed}) images have been processed, Errors: ${errors}.`);
    log(`Note: it migth take a while for images to appear in the output folder, please wait... (do not Ctrl + C)`)

    workers.forEach(worker => worker.terminate());
    // setTimeout(() => process.exit(), 4000);
}

async function processImage(filename) {
    let imgData = await sharp(path.join(inputPath, filename)).raw().toBuffer({ resolveWithObject: true });

    let data = imgData.data;
    let info = imgData.info;

    let textures = [];
    for (let i = 0; i < data.length/4; i++) {
        let r = data[i * 4];
        let g = data[i * 4 + 1];
        let b = data[i * 4 + 2];
        let a = data[i * 4 + 3];

        textures[i] = {file: path.join(palette.dir, palette.dict[palette.map[r][g][b]]), alpha: a};
    }

    let img = sharp({create: {width: info.width * 16, height: info.height * 16, channels: 4, background: {r: 0, g: 0, b: 0}}}).png();

    let images = [];
    for (let i = 0; i < textures.length; i++) {
        let textureData = textures[i];
        let texture;

        if (textureCache[textureData.file] != null) {
            texture = textureCache[textureData.file];
        } else {
            texture = await sharp(textureData.file);
            textureCache[textureData.file] = texture;
        }

        //TODO: fix transparency
        // let buffer;
        // if (textureData.alpha != 0xff) {
        //     let imgData = await texture.raw().toBuffer({ resolveWithObject: true });
        //     let data = new Uint8ClampedArray(imgData.data);
        //     let info = imgData.info;

        //     for (let i = 0; i < data.length/4; i++) {
        //         data.set([textureData.alpha], textureData.alpha);
        //     }

        //     // parentPort.postMessage({action: "log", data: `doing alpha for ${textureData.file}`})
        //     await sharp(data, {raw: {width: info.width, height: info.height, channels: 4, premultiplied: true}}).png().toBuffer();
        // } else {
        //     buffer = await texture.png().toBuffer();
        // }

        let buffer = await texture.png().toBuffer();
        images[i] = {
            input: buffer,
            left: (i % info.width) * 16,
            top: Math.floor(i / info.height) * 16,
        };
    }

    let parsedPath = path.parse(filename);
    let filePath = path.join(outPath, parsedPath.dir, `${parsedPath.name}.png`);
    let dir = path.parse(filePath).dir;

    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });

    await img.composite(images).toFile(filePath);
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