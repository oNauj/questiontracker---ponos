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
    ActionRowBuilder,           
    StringSelectMenuBuilder,    
    StringSelectMenuOptionBuilder, 
    ButtonBuilder,              
    ButtonStyle                 
} = require('discord.js');

// Importando as classes
const CycleRepository = require('./src/classes/CycleRepository');
const StudentManager = require('./src/classes/StudentManager');
const ImageHandler = require('./src/classes/ImageHandler');

const cycles = new CycleRepository();
const students = new StudentManager();
const images = new ImageHandler();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ====================================================
// DEFINIÇÃO DOS COMANDOS
// ====================================================
const commands = [
    new SlashCommandBuilder().setName('ciclo').setDescription('Ver conteúdo do ciclo atual'),
    
    // Suporte a múltiplas imagens
    new SlashCommandBuilder().setName('q').setDescription('Registrar questão')
        .addStringOption(o => o.setName('materia').setDescription('f, q, m, s (Simulado)').setRequired(true))
        .addAttachmentOption(o => o.setName('imagem1').setDescription('Imagem Principal').setRequired(true))
        .addAttachmentOption(o => o.setName('imagem2').setDescription('Imagem Extra (Opcional)').setRequired(false))
        .addAttachmentOption(o => o.setName('imagem3').setDescription('Imagem Extra (Opcional)').setRequired(false)),

    new SlashCommandBuilder().setName('qremover').setDescription('Remove a ÚLTIMA questão enviada neste ciclo'),
    
    new SlashCommandBuilder().setName('ciclocompletar').setDescription('Concluir ciclo atual')
        .addStringOption(o => o.setName('id').setDescription('ID do ciclo (ex: 1.1)').setRequired(true))
        .addIntegerOption(o => o.setName('total').setDescription('Total de questões feitas').setRequired(true)),
    
    new SlashCommandBuilder().setName('rankq').setDescription('Ranking detalhado')
        .addUserOption(o => o.setName('usuario').setDescription('Ver usuário específico')),
    
    new SlashCommandBuilder().setName('bancoq').setDescription('Ver minhas questões organizadas (Interativo)'),

    // NOVO COMANDO PRAZO
    new SlashCommandBuilder().setName('prazo').setDescription('Verifica se você está no ciclo correto baseados nos dias estudados')
        .addIntegerOption(o => o.setName('dias').setDescription('Quantos dias totais você já estudou?').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once(Events.ClientReady, async () => {
    console.log(`✅ Bot logado como ${client.user.tag}`);
    const guildId = client.guilds.cache.first()?.id;
    if (guildId) await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
});

// ====================================================
// FUNÇÕES AUXILIARES DE INTERFACE (MENUS)
// ====================================================

async function renderQuestionMenu(interaction, user, cycleId, page = 0) {
    let questions = [];
    let cycleTitle = "";
    let embedColor = 0x0099FF;

    // Define a fonte dos dados
    if (cycleId === 'current') {
        questions = user.currentCycleHits;
        cycleTitle = `Ciclo Atual (${user.currentCycleId})`;
    } else if (cycleId === 'simulados') {
        questions = user.simulados || [];
        cycleTitle = `🧠 Banco de Simulados`;
        embedColor = 0xFFAA00; // Dourado para destacar
    } else {
        const cycleData = user.history.find(h => h.cycleId === cycleId);
        if (cycleData) {
            questions = cycleData.details || [];
            cycleTitle = `Ciclo ${cycleId}`;
            embedColor = 0x2B2D31;
        }
    }

    if (questions.length === 0) {
        const payload = { content: "⚠️ Não há questões salvas nesta categoria.", components: [], embeds: [] };
        if (interaction.isMessageComponent()) return interaction.update(payload);
        return interaction.reply(payload);
    }

    // Paginação
    const ITEMS_PER_PAGE = 25;
    const totalPages = Math.ceil(questions.length / ITEMS_PER_PAGE);
    
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const start = page * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const currentQuestions = questions.slice(start, end);

    // Criação do Menu
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_question_${cycleId}_${page}`)
        .setPlaceholder(`Página ${page + 1}/${totalPages} - Selecione uma questão`)
        .addOptions(
            currentQuestions.map((q, index) => {
                const globalIndex = start + index;
                // Verifica quantas imagens tem (compatibilidade com formato antigo)
                const countImages = q.files ? q.files.length : (q.url ? 1 : 0);
                
                return new StringSelectMenuOptionBuilder()
                    .setLabel(`Q${globalIndex + 1} - ${q.topic} (${countImages} imgs)`)
                    .setDescription(q.date ? new Date(q.date).toLocaleDateString('pt-BR') : 'Data desc.')
                    .setValue(globalIndex.toString())
            })
        );

    const menuRow = new ActionRowBuilder().addComponents(selectMenu);

    // Botões de Navegação
    const navButtons = [];
    navButtons.push(new ButtonBuilder().setCustomId('btn_back_cycles').setLabel('⬅️ Voltar ao Menu').setStyle(ButtonStyle.Secondary));

    if (page > 0) {
        navButtons.push(new ButtonBuilder().setCustomId(`btn_page_${cycleId}_${page - 1}`).setLabel('◀️ Ant').setStyle(ButtonStyle.Primary));
    }
    if (page < totalPages - 1) {
        navButtons.push(new ButtonBuilder().setCustomId(`btn_page_${cycleId}_${page + 1}`).setLabel('Prox ▶️').setStyle(ButtonStyle.Primary));
    }

    const navRow = new ActionRowBuilder().addComponents(navButtons);

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`📂 ${cycleTitle}`)
        .setFooter({ text: `Página ${page + 1} de ${totalPages} • Total: ${questions.length} questões` })
        .setDescription(`Escolha uma questão abaixo para visualizar.`);

    if (interaction.isMessageComponent()) {
        await interaction.update({ embeds: [embed], components: [menuRow, navRow] });
    } else {
        await interaction.reply({ embeds: [embed], components: [menuRow, navRow] });
    }
}

async function renderCycleMenu(interaction, user) {
    const history = user.history;
    const currentHits = user.currentCycleHits.length;
    const simuladosCount = user.simulados ? user.simulados.length : 0;

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_cycle')
        .setPlaceholder('Selecione onde buscar');

    if (simuladosCount > 0) {
        selectMenu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(`Simulados (Banco Extra)`)
                .setDescription(`${simuladosCount} questões salvas`)
                .setValue('simulados')
                .setEmoji('🧠')
        );
    }

    if (currentHits > 0) {
        selectMenu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(`Ciclo Atual (${user.currentCycleId})`)
                .setDescription(`Em andamento - ${currentHits} questões`)
                .setValue('current')
                .setEmoji('🔄')
        );
    }

    history.slice().reverse().slice(0, 20).forEach(h => {
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
        .setDescription("Selecione um ciclo ou o banco de simulados.");

    if (interaction.isMessageComponent()) {
        await interaction.update({ embeds: [embed], components: [row] });
    } else {
        await interaction.reply({ embeds: [embed], components: [row] });
    }
}

// ====================================================
// EVENTO PRINCIPAL: INTERACTION CREATE
// ====================================================

client.on(Events.InteractionCreate, async interaction => {
    const user = students.getStudent(interaction.user.id, interaction.user.username);

    try {
        // ----------------------------------------------------
        // 1. TRATAMENTO DOS MENUS INTERATIVOS E BOTÕES
        // ----------------------------------------------------
        if (interaction.isStringSelectMenu() || interaction.isButton()) {
            
            // Escolha do Ciclo
            if (interaction.customId === 'select_cycle') {
                const selectedCycleId = interaction.values[0];
                await renderQuestionMenu(interaction, user, selectedCycleId, 0);
            }

            // Paginação
            else if (interaction.customId.startsWith('btn_page_')) {
                const parts = interaction.customId.split('_');
                const cycleId = parts[2];
                const page = parseInt(parts[3]);
                await renderQuestionMenu(interaction, user, cycleId, page);
            }

            // Voltar ao Menu Principal
            else if (interaction.customId === 'btn_back_cycles') {
                await renderCycleMenu(interaction, user);
            }

            // Visualização da Questão (Suporte a múltiplas imagens)
            else if (interaction.customId.startsWith('select_question_')) {
                const parts = interaction.customId.split('_');
                const cycleId = parts[2];
                const page = parseInt(parts[3]);
                const questionIndex = parseInt(interaction.values[0]);

                let questions = [];
                if (cycleId === 'current') questions = user.currentCycleHits;
                else if (cycleId === 'simulados') questions = user.simulados || [];
                else {
                    const cData = user.history.find(h => h.cycleId === cycleId);
                    if (cData) questions = cData.details || [];
                }

                const question = questions[questionIndex];
                if (!question) return interaction.update({ content: "❌ Erro ao carregar questão.", components: [] });

                // Compatibilidade: Converte formato antigo (url única) para array
                let storedFiles = [];
                if (question.files && Array.isArray(question.files)) {
                    storedFiles = question.files;
                } else if (question.url) {
                    storedFiles = [{ url: question.url }];
                }

                const hasFiles = storedFiles.length > 0;
                
                const embed = new EmbedBuilder()
                    .setColor(cycleId === 'simulados' ? 0xFFAA00 : 0x2B2D31)
                    .setTitle(`📝 Questão ${questionIndex + 1} - ${question.topic}`)
                    .setDescription(hasFiles 
                        ? `✅ **${storedFiles.length} Imagem(ns) encontrada(s)!**` 
                        : "⚠️ **Sem imagens salvas.**")
                    .setFooter({ text: `Salva em: ${new Date(question.date).toLocaleString('pt-BR')}` });

                const row = new ActionRowBuilder();
                
                // Botão Voltar
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`btn_page_${cycleId}_${page}`)
                        .setLabel('⬅️ Voltar')
                        .setStyle(ButtonStyle.Secondary)
                );

                // Gera um botão Link para cada imagem (limitado a 4 + botão voltar = 5 max)
                storedFiles.slice(0, 4).forEach((file, idx) => {
                    if (file.url) {
                        row.addComponents(
                            new ButtonBuilder()
                                .setLabel(`Img ${idx + 1}`)
                                .setStyle(ButtonStyle.Link)
                                .setURL(file.url)
                        );
                    }
                });

                await interaction.update({ embeds: [embed], components: [row] });
            }
            return;
        }


        // ----------------------------------------------------
        // 2. TRATAMENTO DOS COMANDOS SLASH
        // ----------------------------------------------------
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

        // --- COMANDO Q (ALTERADO: Multi Imagens + Simulado Separado) ---
        else if (commandName === 'q') {
            await interaction.deferReply(); 
            const type = interaction.options.getString('materia').toLowerCase();
            const typeMap = { 'f': 'Física', 'q': 'Química', 'm': 'Matemática', 's': 'Simulado' };
            
            if (!typeMap[type]) return interaction.editReply({ content: '❌ Use: f, q, m ou s.' });

            // Coleta todas as imagens enviadas
            const attachments = [
                interaction.options.getAttachment('imagem1'),
                interaction.options.getAttachment('imagem2'),
                interaction.options.getAttachment('imagem3')
            ].filter(Boolean); // Remove as que não foram enviadas

            const topicName = typeMap[type];
            // Se for Simulado, não coloca ID do ciclo no nome do arquivo
            const fileSuffix = topicName === 'Simulado' ? 'Simulado' : user.currentCycleId.replace('.', '-');
            
            const processedFiles = [];
            const backupFilesPath = []; 

            // Loop para salvar cada imagem
            for (let i = 0; i < attachments.length; i++) {
                const att = attachments[i];
                const fileName = `${interaction.user.username}_${fileSuffix}_${Date.now()}_${i}.png`;
                
                const savedPath = await images.saveImage(att.url, fileName, topicName);
                
                processedFiles.push({ path: savedPath, url: att.url });
                backupFilesPath.push(savedPath);
            }
            
            // Backup no Discord
            try {
                if (process.env.BACKUP_CHANNEL_ID) {
                    const backupChannel = await client.channels.fetch(process.env.BACKUP_CHANNEL_ID);
                    if (backupChannel) {
                        const sentMsg = await backupChannel.send({
                            content: `💾 **Backup** | User: ${interaction.user.username} | Tipo: ${topicName} | Qtd: ${processedFiles.length}`,
                            files: backupFilesPath
                        });

                        // Atualiza as URLs para as permanentes do Discord
                        const discordAttachments = Array.from(sentMsg.attachments.values());
                        for (let k = 0; k < processedFiles.length; k++) {
                            if (discordAttachments[k]) {
                                processedFiles[k].url = discordAttachments[k].url;
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Erro no backup:", err.message);
            }

            // Salva no banco (Simulado ou Normal)
            const totalHits = students.addHit(interaction.user.id, topicName, processedFiles);
            
            const extraMsg = attachments.length > 1 ? `(${attachments.length} imagens)` : '';

            if (topicName === 'Simulado') {
                await interaction.editReply(`🧠 **Simulado** salvo no Banco Extra! ${extraMsg} Total acumulado: ${totalHits}.`);
            } else {
                await interaction.editReply(`✅ **${topicName}** salva! ${extraMsg} Total no ciclo ${user.currentCycleId}: ${totalHits}.`);
            }
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

        // --- COMANDO PRAZO (NOVO) ---
        else if (commandName === 'prazo') {
            const diasEstudados = interaction.options.getInteger('dias');
            
            // 1. Calcula posição atual no sistema
            const currentId = user.currentCycleId; // ex: "1.2"
            const [currentMacroStr, currentMicroStr] = currentId.split('.');
            const currentMacro = parseInt(currentMacroStr);
            const currentMicro = parseInt(currentMicroStr);

            // Fórmula: (Macro Anterior * 10) + Dias do Macro Atual
            const diasNoSistema = ((currentMacro - 1) * 10) + currentMicro;

            // 2. Calcula posição esperada (9 dias estudo + 1 simulado)
            const expectedMacro = Math.ceil(diasEstudados / 10);
            const expectedMicro = diasEstudados % 10; 
            const isSimuladoDay = (expectedMicro === 0);

            const diferenca = diasEstudados - diasNoSistema;
            const embed = new EmbedBuilder();

            if (diferenca <= 0) {
                // Em dia
                embed.setColor(0x00FF00)
                    .setTitle('✅ Você está em dia!')
                    .setDescription(`Você informou **${diasEstudados} dias**.\nSeu ciclo atual é **${currentId}**.\n\nContinue assim! Você está sincronizado.`);
            } else {
                // Atrasado
                embed.setColor(0xFF0000)
                    .setTitle('⚠️ Alerta de Atraso!')
                    .setDescription(`Você informou **${diasEstudados} dias** de estudo, mas seu sistema marca o ciclo **${currentId}**.`);

                const cicloIdealTexto = isSimuladoDay 
                    ? `**Simulado do Ciclo ${expectedMacro}**` 
                    : `**Ciclo ${expectedMacro}.${expectedMicro}**`;

                embed.addFields(
                    { name: 'Onde deveria estar:', value: `👉 ${cicloIdealTexto}`, inline: true },
                    { name: 'Atraso:', value: `📉 **${diferenca} tópicos** atrás`, inline: true }
                );
            }

            await interaction.reply({ embeds: [embed] });
        }

        // --- COMANDO RANKQ ---
        else if (commandName === 'rankq') {
            const targetUser = interaction.options.getUser('usuario');
            
            const countSubjects = (studentData) => {
                const stats = { 'Matemática': 0, 'Física': 0, 'Química': 0, 'Simulado': 0 };
                // Agrega ciclo atual, histórico e simulados
                const allHits = [
                    ...studentData.currentCycleHits, 
                    ...studentData.history.flatMap(h => h.details || []),
                    ...(studentData.simulados || [])
                ];
                allHits.forEach(hit => { if (stats[hit.topic] !== undefined) stats[hit.topic]++; });
                return stats;
            };

            if (targetUser) {
                const targetData = students.getStudent(targetUser.id, targetUser.username);
                const stats = countSubjects(targetData);
                const embed = new EmbedBuilder()
                    .setTitle(`📈 Estatísticas: ${targetUser.username}`)
                    .setColor(0x00FF00)
                    .setDescription(`Mat: **${stats['Matemática']}** | Fís: **${stats['Física']}** | Quí: **${stats['Química']}** | Sim: **${stats['Simulado']}**`)
                    .addFields({ name: 'Histórico', value: targetData.history.map(h => `**${h.cycleId}**: ${h.hits}/${h.totalQuestions}`).join('\n') || "Vazio" });
                await interaction.reply({ embeds: [embed] });
            } else {
                const allStudents = students.getAllStudents();
                // Ordena por aproveitamento nos Ciclos (Simulado conta apenas para exibição)
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
                        name: `${i+1}º ${s.username} (Aprov. Ciclos: ${rate}%)`, 
                        value: `Ciclos: ${totalH}/${totalQ} • M:${stats['Matemática']} F:${stats['Física']} Q:${stats['Química']} **Sim:${stats['Simulado']}**` 
                    });
                });
                await interaction.reply({ embeds: [embed] });
            }
        }
        
        // --- COMANDO BANCOQ ---
        else if (commandName === 'bancoq') {
             const history = user.history;
             const currentHits = user.currentCycleHits.length;
             const simulados = user.simulados ? user.simulados.length : 0;

             if (history.length === 0 && currentHits === 0 && simulados === 0) {
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