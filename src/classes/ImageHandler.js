const fs = require('fs');
const path = require('path');
const axios = require('axios');

class ImageHandler {
    constructor(baseDir = './images') {
        this.baseDir = baseDir;
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir);
    }

    async saveImage(url, filename, subfolder = '') {
        const dir = path.join(this.baseDir, subfolder);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const filePath = path.join(dir, filename);
        
        const writer = fs.createWriteStream(filePath);
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath));
            writer.on('error', reject);
        });
    }

    getAllImages() {
        // Função recursiva simples para listar arquivos (para o /bancoq)
        const getFiles = (dir) => {
            const subdirs = fs.readdirSync(dir);
            const files = subdirs.map((subdir) => {
                const res = path.resolve(dir, subdir);
                return (fs.statSync(res).isDirectory()) ? getFiles(res) : res;
            });
            return files.reduce((a, f) => a.concat(f), []);
        };
        return getFiles(this.baseDir);
    }
}

module.exports = ImageHandler;