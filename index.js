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
    MessageFlags,
    ActionRowBuilder,           // Adicionado
    StringSelectMenuBuilder,    // Adicionado
    StringSelectMenuOptionBuilder, // Adicionado
    ButtonBuilder,              // Adicionado
    ButtonStyle                 // Adicionado
} = require('discord.js');

// Mantendo seus caminhos originais
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
    new SlashCommandBuilder().setName('bancoq').setDescription('Ver minhas questões organizadas (Interativo)')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once(Events.ClientReady, async () => {
    console.log(`✅ Bot logado como ${client.user.tag}`);
    const guildId = client.guilds.cache.first()?.id;
    if (guildId) await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
});

// --- FUNÇÕES AUXILIARES (NOVO SISTEMA DE MENUS) ---

async function renderQuestionMenu(interaction, user, cycleId, page = 0) {
    let questions = [];
    let cycleTitle = "";

    // 1. Busca as questões
    if (cycleId === 'current') {
        questions = user.currentCycleHits;
        cycleTitle = `Ciclo Atual (${user.currentCycleId})`;
    } else {
        const cycleData = user.history.find(h => h.cycleId === cycleId);
        if (cycleData) {
            questions = cycleData.details || [];
            cycleTitle = `Ciclo ${cycleId}`;
        }
    }

    if (questions.length === 0) {
        // Se não tiver questão, tenta atualizar ou responder
        const payload = { content: "⚠️ Não há questões salvas neste ciclo.", components: [], embeds: [] };
        if (interaction.isMessageComponent()) return interaction.update(payload);
        return interaction.reply(payload);
    }

    // 2. Lógica de Paginação (Limite de 25)
    const ITEMS_PER_PAGE = 25;
    const totalPages = Math.ceil(questions.length / ITEMS_PER_PAGE);
    
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const start = page * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const currentQuestions = questions.slice(start, end);

    // 3. Cria o Menu
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_question_${cycleId}_${page}`)
        .setPlaceholder(`Página ${page + 1}/${totalPages} - Selecione uma questão`)
        .addOptions(
            currentQuestions.map((q, index) => {
                const globalIndex = start + index;
                return new StringSelectMenuOptionBuilder()
                    .setLabel(`Q${globalIndex + 1} - ${q.topic}`)
                    .setDescription(q.date ? new Date(q.date).toLocaleDateString('pt-BR') : 'Data desc.')
                    .setValue(globalIndex.toString())
            })
        );

    const menuRow = new ActionRowBuilder().addComponents(selectMenu);

    // 4. Cria Botões (Voltar, Ant, Prox)
    const navButtons = [];
    navButtons.push(new ButtonBuilder().setCustomId('btn_back_cycles').setLabel('⬅️ Voltar aos Ciclos').setStyle(ButtonStyle.Secondary));

    if (page > 0) {
        navButtons.push(new ButtonBuilder().setCustomId(`btn_page_${cycleId}_${page - 1}`).setLabel('◀️ Ant').setStyle(ButtonStyle.Primary));
    }
    if (page < totalPages - 1) {
        navButtons.push(new ButtonBuilder().setCustomId(`btn_page_${cycleId}_${page + 1}`).setLabel('Prox ▶️').setStyle(ButtonStyle.Primary));
    }

    const navRow = new ActionRowBuilder().addComponents(navButtons);

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`📂 ${cycleTitle}`)
        .setFooter({ text: `Página ${page + 1} de ${totalPages} • Total: ${questions.length} questões` })
        .setDescription(`Escolha uma questão abaixo.`);

    if (interaction.isMessageComponent()) {
        await interaction.update({ embeds: [embed], components: [menuRow, navRow] });
    } else {
        await interaction.reply({ embeds: [embed], components: [menuRow, navRow] });
    }
}

async function renderCycleMenu(interaction, user) {
    const history = user.history;
    const currentHits = user.currentCycleHits.length;

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_cycle')
        .setPlaceholder('Selecione um Ciclo');

    if (currentHits > 0) {
        selectMenu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(`Ciclo Atual (${user.currentCycleId})`)
                .setDescription(`Em andamento - ${currentHits} questões`)
                .setValue('current')
                .setEmoji('🔄')
        );
    }

    // Histórico reverso (mais novos primeiro)
    history.slice().reverse().slice(0, 24).forEach(h => {
        selectMenu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(`Ciclo ${h.cycleId}`)
                .setDescription(`Concluído - ${h.hits} questões`)
                .setValue(h.cycleId)
                .setEmoji('📂')
        );
    });

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle(`📚 Banco de Questões de ${user.username}`)
        .setDescription("Selecione um ciclo para ver as questões.");

    if (interaction.isMessageComponent()) {
        await interaction.update({ embeds: [embed], components: [row] });
    } else {
        await interaction.reply({ embeds: [embed], components: [row] });
    }
}

// --- EVENTO PRINCIPAL ---

client.on(Events.InteractionCreate, async interaction => {
    // Carrega o usuário sempre
    const user = students.getStudent(interaction.user.id, interaction.user.username);

    try {
        // ====================================================
        // 1. TRATAMENTO DOS MENUS INTERATIVOS (NOVO)
        // ====================================================
        if (interaction.isStringSelectMenu() || interaction.isButton()) {
            
            // A. Escolheu um ciclo
            if (interaction.customId === 'select_cycle') {
                const selectedCycleId = interaction.values[0];
                await renderQuestionMenu(interaction, user, selectedCycleId, 0);
            }

            // B. Paginação (Ant/Prox)
            else if (interaction.customId.startsWith('btn_page_')) {
                const parts = interaction.customId.split('_');
                const cycleId = parts[2];
                const page = parseInt(parts[3]);
                await renderQuestionMenu(interaction, user, cycleId, page);
            }

            // C. Voltar para Menu de Ciclos
            else if (interaction.customId === 'btn_back_cycles') {
                await renderCycleMenu(interaction, user);
            }

            // D. Escolheu uma questão específica
            else if (interaction.customId.startsWith('select_question_')) {
                const parts = interaction.customId.split('_');
                const cycleId = parts[2];
                const page = parseInt(parts[3]); // Guarda a página para poder voltar
                const questionIndex = parseInt(interaction.values[0]);

                let questions = [];
                if (cycleId === 'current') questions = user.currentCycleHits;
                else {
                    const cData = user.history.find(h => h.cycleId === cycleId);
                    if (cData) questions = cData.details || [];
                }

                const question = questions[questionIndex];
                if (!question) return interaction.update({ content: "❌ Erro ao carregar questão.", components: [] });

                const url = question.url || '';
                const hasLink = url.length > 0;
                
                const embed = new EmbedBuilder()
                    .setColor(0x2B2D31)
                    .setTitle(`📝 Questão ${questionIndex + 1} - ${question.topic}`)
                    .setDescription(hasLink ? "✅ **Imagem encontrada!** Clique no botão para ver." : "⚠️ **Sem link de backup.**");

                const row = new ActionRowBuilder();
                
                // Botão "Voltar para lista" (na mesma página que estava)
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`btn_page_${cycleId}_${page}`)
                        .setLabel('⬅️ Voltar')
                        .setStyle(ButtonStyle.Secondary)
                );

                if (hasLink) {
                    row.addComponents(
                        new ButtonBuilder().setLabel('Ver Imagem').setStyle(ButtonStyle.Link).setURL(url)
                    );
                }

                await interaction.update({ embeds: [embed], components: [row] });
            }
            return; // Encerra aqui se foi uma interação de menu/botão
        }


        // ====================================================
        // 2. TRATAMENTO DOS COMANDOS SLASH (MANTIDOS ORIGINAIS)
        // ====================================================
        if (!interaction.isChatInputCommand()) return;
        const { commandName } = interaction;

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
                console.error("Erro no backup:", err.message);
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
        
        // --- COMANDO BANCOQ (ATUALIZADO) ---
        else if (commandName === 'bancoq') {
             // Agora apenas chamamos a função auxiliar que gera o menu
             const history = user.history;
             const currentHits = user.currentCycleHits.length;

             if (history.length === 0 && currentHits === 0) {
                 return interaction.reply({ content: "Você ainda não tem questões registradas.", flags: MessageFlags.Ephemeral });
             }
             
             await renderCycleMenu(interaction, user);
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