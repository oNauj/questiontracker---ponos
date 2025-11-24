require('dotenv').config();
const path = require('path');
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    Routes, 
    REST, 
    SlashCommandBuilder, 
    Events, 
    MessageFlags 
} = require('discord.js');

const CycleRepository = require('./src/classes/CycleRepository');
const StudentManager = require('./src/classes/StudentManager');
const ImageHandler = require('./src/classes/ImageHandler');


const cycles = new CycleRepository();
const students = new StudentManager();
const images = new ImageHandler();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const commands = [
    new SlashCommandBuilder().setName('ciclo').setDescription('Ver conteúdo do ciclo atual'),
    new SlashCommandBuilder().setName('q').setDescription('Registrar questão')
        .addStringOption(o => o.setName('materia').setDescription('f, q, m, s').setRequired(true))
        .addAttachmentOption(o => o.setName('imagem').setDescription('Print da questão').setRequired(true)),
    new SlashCommandBuilder().setName('qremover').setDescription('Remove a ÚLTIMA questão enviada neste ciclo (caso tenha errado)'),
    new SlashCommandBuilder().setName('ciclocompletar').setDescription('Concluir ciclo atual')
        .addStringOption(o => o.setName('id').setDescription('ID do ciclo (ex: 1.1)').setRequired(true))
        .addIntegerOption(o => o.setName('total').setDescription('Total de questões feitas').setRequired(true)),
    new SlashCommandBuilder().setName('rankq').setDescription('Ranking detalhado')
        .addUserOption(o => o.setName('usuario').setDescription('Ver usuário específico')),
    new SlashCommandBuilder().setName('bancoq').setDescription('Ver minhas questões organizadas')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once(Events.ClientReady, async () => {
    console.log(`✅ Bot logado como ${client.user.tag}`);
    const guildId = client.guilds.cache.first()?.id;
    if (guildId) await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const user = students.getStudent(interaction.user.id, interaction.user.username);

    try {
        // --- COMANDO CICLO ---
        if (commandName === 'ciclo') {
            const currentCycle = cycles.getCycle(user.currentCycleId);
            
            if (!currentCycle) return interaction.reply({ content: '🎉 Parabéns! Você completou TUDO!', flags: MessageFlags.Ephemeral });

            const nextCycles = cycles.getNextCycles(user.currentCycleId, 4);
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`📊 Progresso de ${interaction.user.username}`)
                .setDescription(`**Ciclo Atual #${currentCycle.id}**\n📖 ${currentCycle.topic}`)
                .addFields({ name: `✅ Acertos neste tópico`, value: `${user.currentCycleHits.length}`, inline: true });

            if (nextCycles.length > 0) {
                const nextList = nextCycles.map(c => `**${c.id}:** ${c.topic}`).join('\n');
                embed.addFields({ name: '⏩ Próximos', value: nextList });
            }
            await interaction.reply({ embeds: [embed] });
        }

        // --- COMANDO Q ---
        else if (commandName === 'q') {
            await interaction.deferReply(); 
            const type = interaction.options.getString('materia').toLowerCase();
            const attachment = interaction.options.getAttachment('imagem');
            const typeMap = { 'f': 'Física', 'q': 'Química', 'm': 'Matemática', 's': 'Simulado' };
            
            if (!typeMap[type]) return interaction.editReply({ content: '❌ Use: f, q, m ou s.' });

            const fileName = `${interaction.user.username}_${user.currentCycleId.replace('.', '-')}_${Date.now()}.png`;
            const savedPath = await images.saveImage(attachment.url, fileName, typeMap[type]); 
            
            let permanentUrl = attachment.url;
            
            // Bloco de Backup Isolado (Se falhar, não impede de salvar a questão)
            try {
                if (process.env.BACKUP_CHANNEL_ID) {
                    const backupChannel = await client.channels.fetch(process.env.BACKUP_CHANNEL_ID);
                    if (backupChannel) {
                        const sentMsg = await backupChannel.send({
                            content: `💾 **Backup** | User: ${interaction.user.username} | ID: ${user.currentCycleId}`,
                            files: [savedPath] 
                        });
                        permanentUrl = sentMsg.url; 
                    }
                }
            } catch (err) {
                console.error("Erro no backup (imagem salva apenas localmente):", err.message);
            }

            const totalHits = students.addHit(interaction.user.id, typeMap[type], savedPath, permanentUrl);
            await interaction.editReply(`✅ **${typeMap[type]}** salva! Total no ciclo ${user.currentCycleId}: ${totalHits}.`);
        }

        // --- COMANDO QREMOVER ---
        else if (commandName === 'qremover') {
            const result = students.removeLastHit(interaction.user.id);
            if (!result.success) {
                return interaction.reply({ content: `⚠️ ${result.msg}`, flags: MessageFlags.Ephemeral });
            }
            await interaction.reply(`🗑️ Última questão de **${result.topic}** removida! Restam ${result.remaining} no ciclo.`);
        }

        // --- COMANDO CICLOCOMPLETAR ---
        else if (commandName === 'ciclocompletar') {
            const id = interaction.options.getString('id');
            const total = interaction.options.getInteger('total');
            
            const nextId = cycles.getNextCycleId(id);

            const result = students.completeCycle(interaction.user.id, id, total, nextId);

            if (!result.success) return interaction.reply({ content: `❌ ${result.msg}`, flags: MessageFlags.Ephemeral });
            
            if (result.finished) {
                await interaction.reply(`🏆 **Ciclo ${id} Concluído!** Você zerou o cronograma! Parabéns!`);
            } else {
                await interaction.reply(`🏆 **Ciclo ${id} Concluído!** Avançando para: **${result.nextCycle}**`);
            }
        }

        // --- COMANDO RANKQ ---
        else if (commandName === 'rankq') {
            const targetUser = interaction.options.getUser('usuario');
            const countSubjects = (studentData) => {
                const stats = { 'Matemática': 0, 'Física': 0, 'Química': 0, 'Simulado': 0 };
                const allHits = [...studentData.currentCycleHits, ...studentData.history.flatMap(h => h.details || [])];
                allHits.forEach(hit => { if (stats[hit.topic] !== undefined) stats[hit.topic]++; });
                return stats;
            };

            if (targetUser) {
                const targetData = students.getStudent(targetUser.id, targetUser.username);
                const stats = countSubjects(targetData);
                const embed = new EmbedBuilder()
                    .setTitle(`📈 Estatísticas: ${targetUser.username}`)
                    .setDescription(`Mat: **${stats['Matemática']}** | Fís: **${stats['Física']}** | Quí: **${stats['Química']}**`)
                    .addFields({ name: 'Histórico', value: targetData.history.map(h => `**${h.cycleId}**: ${h.hits}/${h.totalQuestions}`).join('\n') || "Vazio" });
                await interaction.reply({ embeds: [embed] });
            } else {
                const allStudents = students.getAllStudents();
                
                // Lógica de ordenação (Aproveitamento Geral)
                allStudents.sort((a, b) => {
                    const calcRate = (s) => {
                        const h = s.history.reduce((acc, cur) => acc + cur.hits, 0);
                        const t = s.history.reduce((acc, cur) => acc + cur.totalQuestions, 0);
                        return t === 0 ? 0 : h / t;
                    };
                    return calcRate(b) - calcRate(a);
                });

                const embed = new EmbedBuilder().setTitle(`🏆 Ranking Geral de Estudos`).setColor(0xFFD700);
                
                allStudents.forEach((s, i) => {
                    const stats = countSubjects(s);
                    const totalH = s.history.reduce((acc, cur) => acc + cur.hits, 0);
                    const totalQ = s.history.reduce((acc, cur) => acc + cur.totalQuestions, 0);
                    const rate = totalQ > 0 ? ((totalH/totalQ)*100).toFixed(1) : 0;
                    
                    embed.addFields({ 
                        name: `${i+1}º ${s.username} (Aproveitamento: ${rate}%)`, 
                        value: `${totalH}/${totalQ} Totais • M:${stats['Matemática']} F:${stats['Física']} Q:${stats['Química']}` 
                    });
                });

                await interaction.reply({ embeds: [embed] });
            }
        }
        
        // --- COMANDO BANCOQ ---
        else if (commandName === 'bancoq') {
             const history = user.history;
             const current = user.currentCycleHits;
             const embed = new EmbedBuilder().setTitle(`📚 Banco de Questões de ${interaction.user.username}`).setColor(0x2B2D31);
             
             // Histórico
             history.slice(-3).forEach(cycle => {
                if (cycle.details?.length) {
                    const lines = cycle.details.map((d, i) => {
                        const url = d.url || '';
                        const linkText = url.includes('discord.com/channels') ? 'Ver Backup' : 'Link Antigo';
                        return url ? `[${d.topic}] Q${i+1}: [${linkText}](${url})` : `[${d.topic}] Q${i+1}: (Sem link)`;
                    }).join('\n');
                    embed.addFields({ name: `📂 Ciclo ${cycle.cycleId}`, value: lines.substring(0, 1024) });
                }
             });

             // Ciclo Atual (Estava faltando no seu código)
             if (current.length > 0) {
                 const lines = current.map((d, i) => {
                     const url = d.url || '';
                     const linkText = url.includes('discord.com/channels') ? 'Ver Backup' : 'Link Antigo';
                     return url ? `[${d.topic}] Q${i+1}: [${linkText}](${url})` : `[${d.topic}] Q${i+1}: (Sem link)`;
                 }).join('\n');
                 embed.addFields({ name: `🔄 Ciclo Atual (${user.currentCycleId})`, value: lines.substring(0, 1024) });
             } else if (history.length === 0) {
                 embed.setDescription("Nenhuma questão registrada ainda.");
             }

             await interaction.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Erro geral no comando:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Erro interno ao executar o comando.', flags: MessageFlags.Ephemeral });
        } else if (interaction.deferred) {
            await interaction.editReply({ content: 'Erro interno ao processar o comando.' });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);