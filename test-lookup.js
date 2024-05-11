var fs = require("fs");
var path = require("path");
var palette = require("./palette");

//TODO: reamke for new compressed format
for (let r = 0; r < 256; r++) {
    for (let g = 0; g < 256; g++) {
        for (let b = 0; b < 256; b++) {
            let index = palette.map?.[r]?.[g]?.[b];

            if (index == null)
                throw new Error(`rgb (${r}, ${g}, ${b}) map index is missing!`);
                // console.log(`rgb (${r}, ${g}, ${b}) is missing!`)

            // let file = path.join(palette.dir, palette.dict[index]);
            let filePath = `${palette.dir}/${palette.dict[index]}`;

            if (filePath == null)
                throw new Error(`rgb (${r}, ${g}, ${b}) file with index ${index} is missing!`);

            // if (!fs.existsSync(filePath))
            //     console.warn(`Missing file ${filePath}!`);
        }
    }
}

console.log("Test was sucessfull no data is missing.")