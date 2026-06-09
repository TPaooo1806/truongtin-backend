const fs = require('fs');
const path = require('path');

const controllersDir = path.join(__dirname, 'src', 'controllers');

function processDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDir(fullPath);
        } else if (fullPath.endsWith('.ts')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let modified = false;

            // Simple regex: find "catch (error) {" or "catch (error: any) {"
            // Make sure not to duplicate console.error
            content = content.replace(/catch\s*\((.*?)\)\s*\{([\s\S]*?)(res\.status)/g, (match, errVar, between, resStatus) => {
                if (!between.includes('console.error')) {
                    modified = true;
                    return `catch (${errVar}) {\n    console.error("Lỗi:", ${errVar.split(':')[0]});${between}${resStatus}`;
                }
                return match;
            });

            if (modified) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log(`Updated ${file}`);
            }
        }
    }
}

processDir(controllersDir);
console.log('Done!');
