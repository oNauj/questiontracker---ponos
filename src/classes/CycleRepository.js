const fs = require('fs');
const path = require('path');

class CycleRepository {
    constructor() {
        this.filePath = path.join(__dirname, '../../data/cycles.json');
        this.cycles = [];
        this.load();
    }

    load() {
        if (fs.existsSync(this.filePath)) {
            const rawData = fs.readFileSync(this.filePath, 'utf8');
            this.cycles = JSON.parse(rawData);
        } else {
            console.error("ERRO: Arquivo data/cycles.json não encontrado!");
        }
    }

    getCycle(id) {
        // Agora busca pelo ID String ("1.1")
        return this.cycles.find(c => c.id === id);
    }
    
    // Lógica para pegar o próximo ciclo com base na ordem do Array
    getNextCycleId(currentId) {
        const index = this.cycles.findIndex(c => c.id === currentId);
        if (index !== -1 && index + 1 < this.cycles.length) {
            return this.cycles[index + 1].id;
        }
        return null; // Fim dos ciclos
    }

    getNextCycles(currentId, amount = 4) {
        const index = this.cycles.findIndex(c => c.id === currentId);
        if (index === -1) return [];
        return this.cycles.slice(index + 1, index + 1 + amount);
    }
}

module.exports = CycleRepository;