var fs = require("fs");
var path = require("path");
var Jimp = require("jimp");
var mcData = require("minecraft-data")("1.19");

if (!fs.existsSync("./block_palette"))
    fs.mkdirSync("./block_palette");

//sort normal blocks:
if (!fs.existsSync("./block_palette/normal_blocks"))
    fs.mkdirSync("./block_palette/normal_blocks");

let files = fs.readdirSync("./palette").filter(s => s.endsWith(".png") && !s.includes("_top") && !s.includes("_front") && !s.includes("_back") && !s.includes("_bottom"));
files.forEach(async (file) => {
    let name = file.slice(0, file.length - 4);
    if (mcData.blocksByName[name] == null && mcData.blockCollisionShapes.blocks[name] != 1)
        return;
    let filePath = path.join("./palette", file);

    let img = await Jimp.read(filePath);

    if (img.bitmap.width != 16 || img.bitmap.height != 16)
        return;

    for (let i = 0; i < img.bitmap.data.length / 4; i++) {
        let alpha = img.bitmap.data[i * 4 + 3];

        if (alpha != 255)
            return;
    }


    fs.copyFileSync(filePath, path.join("./block_palette/normal_blocks", file));
});

//top block:
if (!fs.existsSync("./block_palette/top_blocks"))
    fs.mkdirSync("./block_palette/top_blocks");

files = fs.readdirSync("./palette").filter(s => s.includes("_top") && s.endsWith("_top.png"));
files.forEach(async (file) => {
    let name = file.slice(0, file.length - "_top.png".length); 
    if (mcData.blocksByName[name] == null && mcData.blockCollisionShapes.blocks[name] != 1)
        return;
    let filePath = path.join("./palette", file);

    let img = await Jimp.read(filePath);

    if (img.bitmap.width != 16 || img.bitmap.height != 16)
        return;


    for (let i = 0; i < img.bitmap.data.length / 4; i++) {
        let alpha = img.bitmap.data[i * 4 + 3];

        if (alpha != 255)
            return;
    }


    fs.copyFileSync(filePath, path.join("./block_palette/top_blocks", name + ".png"));
});

//front blocks
if (!fs.existsSync("./block_palette/front_blocks"))
    fs.mkdirSync("./block_palette/front_blocks");

files = fs.readdirSync("./palette").filter(s => s.includes("_front") && s.endsWith("_front.png"));
files.forEach(async (file) => {
    let name = file.slice(0, file.length - "_front.png".length); 
    if (mcData.blocksByName[name] == null && mcData.blockCollisionShapes.blocks[name] != 1)
        return;
    let filePath = path.join("./palette", file);

    let img = await Jimp.read(filePath);

    if (img.bitmap.width != 16 || img.bitmap.height != 16)
        return;


    for (let i = 0; i < img.bitmap.data.length / 4; i++) {
        let alpha = img.bitmap.data[i * 4 + 3];

        if (alpha != 255)
            return;
    }


    fs.copyFileSync(filePath, path.join("./block_palette/front_blocks", name + ".png"));
});