const fs = require('fs');
const path = require('path');

class StudentManager {
    constructor(dbPath = './data/students.json') {
        this.dbPath = dbPath;
        this.data = {};
        this.load();
    }

    load() {
        if (fs.existsSync(this.dbPath)) {
            this.data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
        }
    }

    save() {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
    }

    getStudent(userId, username) {
        if (!this.data[userId]) {
            this.data[userId] = {
                username: username,
                currentCycleId: "1.1",
                currentCycleHits: [], 
                simulados: [],
                history: [] 
            };
            this.save();
        }
        if (!this.data[userId].simulados) {
            this.data[userId].simulados = [];
            this.save();
        }
        return this.data[userId];
    }

    // --- MUDANÇA AQUI: filesData deve ser um array [{ path, url }] ---
    addHit(userId, topic, filesData) {
        const student = this.getStudent(userId);
        
        // Estrutura do objeto salva no JSON
        const hitData = { 
            topic, 
            files: filesData, // Agora salvamos o array com todas as imagens
            date: new Date() 
        };

        if (topic === 'Simulado') {
            student.simulados.push(hitData);
            this.save();
            return student.simulados.length;
        } 

        student.currentCycleHits.push(hitData);
        this.save();
        return student.currentCycleHits.length;
    }

    removeLastHit(userId) {
        const student = this.data[userId];
        if (!student || student.currentCycleHits.length === 0) {
            return { success: false, msg: "Nenhuma questão para remover no ciclo atual." };
        }

        const removed = student.currentCycleHits.pop();
        this.save();

        // Tenta apagar todos os arquivos locais vinculados a essa questão
        if (removed.files && Array.isArray(removed.files)) {
            removed.files.forEach(file => {
                try {
                    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                } catch (e) { console.error("Erro ao apagar arquivo:", e); }
            });
        } else if (removed.imagePath) {
            // Compatibilidade com estrutura antiga
            try {
                if (fs.existsSync(removed.imagePath)) fs.unlinkSync(removed.imagePath);
            } catch (e) {}
        }

        return { success: true, topic: removed.topic, remaining: student.currentCycleHits.length };
    }

    completeCycle(userId, cycleId, totalQuestions, nextCycleId) {
        const student = this.data[userId];
        
        if (student.currentCycleId !== cycleId) return { success: false, msg: `Você está no ciclo ${student.currentCycleId}, não no ${cycleId}!` };
        
        student.history.push({
            cycleId: cycleId,
            totalQuestions: parseInt(totalQuestions),
            hits: student.currentCycleHits.length,
            details: [...student.currentCycleHits]
        });

        if (nextCycleId) {
            student.currentCycleId = nextCycleId;
        } else {
            return { success: true, finished: true };
        }
        
        student.currentCycleHits = [];
        this.save();

        return { success: true, nextCycle: student.currentCycleId };
    }

    getAllStudents() {
        return Object.values(this.data);
    }
}

module.exports = StudentManager;