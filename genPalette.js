var fs = require("fs");
var path = require("path");
var Jimp = require("jimp");
var {Worker, isMainThread, parentPort, workerData} = require("worker_threads");

//TODO: better transparency control + fix bug of not loading images with folder depth > 1
var palettePath = "./palette"; 
var outFile = "./palette.json";
var useOnlyOpaque = true;
var imageSize = 16;
var allowedExt = [".png"]
var workerCount = 4;

if (isMainThread)
    parseColorMap();
else 
    genLookupTable();

async function parseColorMap() {
    if (!fs.existsSync(palettePath))
    fs.mkdirSync(palettePath);

    let colorMap = {};

    forEachFile(palettePath, async (file) => {
        log(`Parsing ${file}...`);

        let parsedPath = path.parse(file);
        if (!allowedExt.includes(parsedPath.ext))
            return;

        let img = await Jimp.read(file);

        if (img.bitmap.width != imageSize || img.bitmap.height != imageSize)
            return;

        if (!img.bitmap.alpha) {
            for (let i = 0; i < img.bitmap.data.length / 4; i++) {
                if (!useOnlyOpaque)
                    break;
                let alpha = img.bitmap.data[i * 4 + 3];
    
                if (alpha != 255)
                    return;
            }
        }

        colorMap[file] = (await img.resize(1, 1).bitmap.data).slice(0, 3);
    })
    
    //TODO: wait for the program to load all files
    setTimeout(() => {
        log(`\n\nGenerating color look up table...`);
        
        let count = 256**3;
        let tableData = new Array(workerCount);
        
        let progressTable = new Array(workerCount).fill(0);
        let doneCount = 0;
        for (let i = 0; i < workerCount; i++) {
            let worker = new Worker(__filename, {
                workerData: {
                    start: Math.floor(count / workerCount) * i,
                    end: (i == workerCount - 1) ? count : Math.floor(count / workerCount) * (i + 1),
                    colorMap: colorMap,
                    index: i
                }
            });

            let lastProgress = { value: 0, timestamp: 0 };
            let progressPerSecondAvg = [];
            worker.on("message", (message) => {
                if (message.action == "log") {
                    log(`(${i}) -> ${message.data}`);
                    return;
                }

                if (message.action == "progress") {
                    progressTable[i] = message.data;
                    let progress = progressTable.map((p) => p / workerCount).reduce((t, c) => t + c);
                    
                    let timestamp = Date.now();
                    let deltaProgress = (progress - lastProgress.value);
                    let progressPerSecond = (deltaProgress / (timestamp - lastProgress.timestamp));

                    progressPerSecondAvg.push(progressPerSecond);
                    if (progressPerSecondAvg.length > 10)
                        progressPerSecondAvg.shift();

                    progressPerSecond = progressPerSecondAvg.reduce((t, c) => t + c) / progressPerSecondAvg.length;
                    let timeEstimate = timestampToString((100 - progress) / progressPerSecond);

                    log(`Color lookup table processing: ${progress.toFixed(7)}%, time estimate: ${timeEstimate}`);

                    lastProgress = { value: progress, timestamp: Date.now() };
                    return;
                }

                if (message.action != "done")
                    return;
                log(`Worker index ${i} is done!`);
                tableData[i] = message.data;

                doneCount++;
                if (doneCount != workerCount)
                    return;
                
                log(`Color lookup table processing: 100%, time estimate: 0h 0m 0s`);
                log(`All workers are done, writing color look up table...`);

                let fullTableArray = [];
                for (let j = 0; j < tableData.length; j++) {
                    log(`Color look up table index ${j} length: ${tableData[j].length}`)
                    fullTableArray = fullTableArray.concat(tableData[j]);                        
                }
                log(`Full color look up table length: ${fullTableArray.length}`)

                let lookupTable = {
                    dir: palettePath,
                    imgSize: imageSize,
                    dict: Object.keys(colorMap).map((file) => path.relative(palettePath, file)),
                    map: []
                };
                for (let j = 0; j < fullTableArray.length; j++) {
                    let r = Math.floor(j / 256**2) % 256;
                    let g = Math.floor(j / 256) % 256;
                    let b = j % 256;

                    if (lookupTable.map[r] == null)
                        lookupTable.map[r] = [];
                    if (lookupTable.map[r][g] == null)
                        lookupTable.map[r][g] = [];
                    if (lookupTable.map[r][g][b] == null)
                        lookupTable.map[r][g][b] = [];

                    lookupTable.map[r][g][b] = fullTableArray[j];
                }

                log(`Compressing look up table...`)
                let reducedMap = [];
                let curr = lookupTable.map[0][0][0];
                let start = 0;
                let end = 0;
                for (let r = 0; r < 256; r++) {
                    for (let g = 0; g < 256; g++) {
                        for (let b = 0; b < 256; b++) {
                            let color = (r << 16) | (g << 8) | b;
                            let value = lookupTable.map[r][g][b];

                            if (curr != value || color == ((255 << 16) | (255 << 8) | 255)) {
                                if (color == ((255 << 16) | (255 << 8) | 255))
                                    end++;
                                reducedMap.push(`${curr}:${start}->${end + 1}`);
                                curr = value;
                                start = end + 1;
                            }

                            end = color;
                        }
                    }
                }
                lookupTable.map = reducedMap;

                try {
                    fs.writeFileSync(outFile, JSON.stringify(lookupTable));
                    log(`Color lookup table sucessfully written to "${outFile}"`);
                } catch (err) {
                    log(`Error while writing table!`);
                    console.log(err);
                }

                //TODO: comment out after testing
                // log(`Console mode enabled.`)
                // let r = require("repl").start("> ");
                // r.context.table = lookupTable;
            });
        }
    }, 2000);
}

function genLookupTable() {
    let colorMap = workerData.colorMap;
    let start = workerData.start;
    let end = workerData.end;
    log(`Index: ${workerData.index}, start: ${start}, end: ${end}`);
    
    //for (let i = 0; i < 256**3; i++) console.log(`r: ${Math.floor(i / 256**2) % 256}, g: ${Math.floor(i / 256) % 256}, b: ${i % 256}`)

    let timestamp = Date.now();
    let colors = [];
    for (let i = start; i < end; i++) {
        let r = Math.floor(i / 256**2) % 256;
        let g = Math.floor(i / 256) % 256;
        let b = i % 256;

        // parentPort.postMessage({action: "log", data: ``})
        // parentPort.postMessage({action: "log", data: `curr color index: ${i}, rgb: (${r}, ${g}, ${b})`})

        let color = getNearestColor(r, g, b, colorMap);
        colors.push(Object.keys(colorMap).indexOf(color.key));
        // log(`(${r}, ${g}, ${b}) -> ${color.key}`);

        if (Date.now() - timestamp >= 200) {
            parentPort.postMessage({
                action: "progress",
                data: (i - start) / (end - start) * 100
            });
            timestamp = Date.now();
        }
    }

    parentPort.postMessage({
        action: "done",
        data: colors
    });
}

function getNearestColor(r, g, b, colors) {
    let color = null;
    let dist = Infinity;

    Object.keys(colors).forEach(key => {
        if (dist == 0)
            return;

        let rgb = colors[key];
        let colorDist = (r - rgb[0])**2 + (g - rgb[1])**2 + (b - rgb[2])**2;

        // parentPort.postMessage({action: "log", data: `key: ${key}, rgb: (${rgb[0]}, ${rgb[1]}, ${rgb[2]}), dist: ${colorDist}, curr dist: ${dist}`})
        if (colorDist < dist) {
            color = key;
            dist = colorDist;
        }
    });

    // console.log(`(${Object.keys(colors).length}) color: ${color}, dist: ${dist}`);

    return {
        key: color,
        value: colors[color]
    };
}

function forEachFile(directory, callback) {
    // directory = path.resolve(directory);
    if (!fs.existsSync(directory))
        return;

    fs.readdirSync(directory).forEach(file => {
        let filePath = path.join(directory, file);

        if (fs.statSync(filePath).isDirectory()) {
            forEachFile(path.join(directory, filePath), callback);
            return;
        }

        callback(filePath);
    });
}

function timestampToString(timestamp) {
    return `${Math.floor(timestamp / (60 * 60 * 1000))}h ${Math.floor(timestamp / (60 * 1000)) % 60}m ${Math.floor(timestamp / 1000) % 60}s`;
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