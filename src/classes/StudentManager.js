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
                currentCycleId: "1.1", // Começa no 1.1 agora
                currentCycleHits: [], 
                history: [] 
            };
            this.save();
        }
        return this.data[userId];
    }

    addHit(userId, topic, imagePath, url) {
        const student = this.data[userId];
        student.currentCycleHits.push({ topic, imagePath, url, date: new Date() });
        this.save();
        return student.currentCycleHits.length;
    }

    // --- NOVA FUNÇÃO DE REMOVER ---
    removeLastHit(userId) {
        const student = this.data[userId];
        if (!student || student.currentCycleHits.length === 0) {
            return { success: false, msg: "Nenhuma questão para remover no ciclo atual." };
        }

        const removed = student.currentCycleHits.pop(); // Remove o último
        this.save();

        // Tenta apagar o arquivo do computador para economizar espaço
        try {
            if (fs.existsSync(removed.imagePath)) {
                fs.unlinkSync(removed.imagePath);
            }
        } catch (e) {
            console.error("Erro ao apagar arquivo local:", e);
        }

        return { success: true, topic: removed.topic, remaining: student.currentCycleHits.length };
    }

    completeCycle(userId, cycleId, totalQuestions, nextCycleId) {
        const student = this.data[userId];
        
        // Compara IDs como string
        if (student.currentCycleId !== cycleId) return { success: false, msg: `Você está no ciclo ${student.currentCycleId}, não no ${cycleId}!` };
        
        student.history.push({
            cycleId: cycleId,
            totalQuestions: parseInt(totalQuestions),
            hits: student.currentCycleHits.length,
            details: [...student.currentCycleHits]
        });

        // Avança para o próximo ID calculado pelo Repository
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