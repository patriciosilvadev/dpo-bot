require('dotenv').config();

const assistenteAPI = require('./chatbot_api');
// const opt = require('./util/options');
const { createIssue } = require('./utils/send_issue');
const flow = require('./utils/flow');
const help = require('./utils/helper');
const dialogs = require('./utils/dialogs');
const attach = require('./utils/attach');
const DF = require('./utils/dialogFlow');
const quiz = require('./utils/quiz');
const timer = require('./utils/timer');
const input = require('./utils/input');
const { reloadTicket } = require('./utils/checkQR'); // eslint-disable-line

const incidenteCPFAux = {}; // because the file timer stops setState from working

const getPageID = (context) => {
	if (context && context.event && context.event.rawEvent && context.event.rawEvent.recipient && context.event.rawEvent.recipient.id) {
		return context.event.rawEvent.recipient.id;
	}
	return process.env.REACT_APP_MESSENGER_PAGE_ID;
};


module.exports = async function App(context) {
	await context.setState({
		politicianData: await assistenteAPI.getPoliticianData(getPageID(context)),
		sessionUser: { ...await context.getUserProfile() },
	});

	try {
		// await reloadTicket(context); await help.resumoTicket(context.state.ticketTypes.ticket_types);
		// we update context data at every interaction that's not a comment or a post
		await assistenteAPI.postRecipient(context.state.politicianData.user_id, {
			fb_id: context.session.user.id,
			name: context.state.sessionUser.name,
			origin_dialog: 'greetings',
			picture: context.state.sessionUser.profilePic,
			// session: JSON.stringify(context.state),
		});

		await timer.deleteTimers(context.session.user.id);

		if (context.event.isPostback) {
			await context.setState({ lastPBpayload: context.event.postback.payload });
			await input.handlePostback(context);
			await assistenteAPI.logFlowChange(context.session.user.id, context.state.politicianData.user_id,
				context.event.postback.payload, context.event.postback.title);
		} else if (context.event.isQuickReply) {
			await context.setState({ lastQRpayload: context.event.quickReply.payload });
			await input.handleQuickReply(context);
			await assistenteAPI.logFlowChange(context.session.user.id, context.state.politicianData.user_id, context.state.lastQRpayload, context.state.lastQRpayload);
		} else if (input.isButton(context) === true) {
			await context.setState({ lastQRpayload: context.event.rawEvent.message.value });
			await input.handleQuickReply(context);
		} else if (input.isText(context) === true) {
			await input.handleText(context);
		} else if (context.event.isFile || context.event.isVideo || context.event.isImage) {
			if (['incidenteAskFile', 'incidenteI', 'incidenteA', 'incidenteFilesTimer'].includes(context.state.dialog)) {
				await dialogs.handleFiles(context, 'incidenteFilesTimer');
			} else if (['avançadoAskFile', 'avançadoM', 'avançadoA', 'avançadoFilesTimer'].includes(context.state.dialog)) {
				await dialogs.handleFiles(context, 'avançadoFilesTimer');
			}
		}

		switch (context.state.dialog) {
		case 'greetings':
			await context.sendImage(flow.avatarImage);
			if (context.session.platform !== 'browser') {
				await context.sendText(flow.greetings.text1.replace('<USERNAME>', context.state.sessionUser.firstName));
			} else {
				await context.sendText(flow.greetings.text1b);
			}
			await attach.sendMsgFromAssistente(context, 'greetings', [flow.greetings.text2]);
			await dialogs.sendMainMenu(context, flow.mainMenu.firstTime);
			break;
		case 'mainMenu':
			await dialogs.sendMainMenu(context);
			break;
		case 'faleConosco':
			await attach.sendMsgFromAssistente(context, 'fale-conosco', []);
			await dialogs.sendMainMenu(context);
			break;
		case 'solicitacoes':
			await context.setState({ whatWasTyped: 'Quero fazer uma solicitação' });
			await DF.dialogFlow(context);
			// await context.sendText(flow.solicitacoes.text1);
			// await dialogs.solicitacoesMenu(context);
			break;
		case 'confirmaSolicitacao':
			await dialogs.confirmaSolicitacao(context);
			break;
		case 'consumidor':
			await dialogs.consumidorMenu(context);
			break;
		case 'titularNao':
			await context.sendText(flow.CPFConfirm.revogacaoNao);
			await dialogs.sendMainMenu(context);
			break;
		case 'solicitacao1': // revogar
			await attach.sendMsgFromAssistente(context, 'ticket_type_1', [flow.revogar.text1, flow.revogar.text2]);
			await context.sendText(flow.revogar.text3, await attach.getQR(flow.revogar));
			break;
		case 'revogacaoNao':
			await context.sendText(flow.revogar.revogacaoNao);
			await dialogs.sendMainMenu(context);
			break;
		case 'askRevogarCPF':
			await context.sendText(flow.revogar.askRevogarCPF + flow.askCPF.clickTheButton, await attach.getQR(flow.askCPF));
			break;
		case 'askRevogarTitular':
			await context.sendText(flow.CPFConfirm.ask.replace('<CPF>', context.state.titularCPF), await attach.getQRCPF(flow.CPFConfirm, flow.revogar.CPFNext));
			break;
		// case 'askRevogarName':
		// 	await context.sendText(flow.revogar.askRevogarName, await attach.getQR(flow.askCPF));
		// 	break;
		// case 'askRevogarPhone':
		// 	await context.sendText(flow.revogar.askRevogarPhone, await attach.getQR(flow.askCPF));
		// 	break;
		case 'askRevogarMail':
			await context.sendText(flow.revogar.askRevogarMail, await attach.getQR(flow.askCPF));
			break;
		case 'gerarTicket1': {
			await context.setState({ ticketID: '1' });
			const { id } = context.state.ticketTypes.ticket_types.find((x) => x.ticket_type_id.toString() === context.state.ticketID);
			await dialogs.createTicket(context,
				await assistenteAPI.postNewTicket(context.state.politicianData.organization_chatbot_id, context.session.user.id, id, await help.buildTicket(context.state)));
		} break;
		case 'solicitacao':
			await attach.sendMsgFromAssistente(context, `ticket_type_${context.state.ticketID}`, []);
			await context.sendText(`${flow.solicitacao.askCPF.base}${flow.solicitacao.askCPF[context.state.ticketID]} ${flow.solicitacao.clickTheButton}`, await attach.getQR(flow.solicitacao));
			await context.setState({ dialog: 'askCPF' });
			break;
		case 'askTitular':
			await context.sendText(flow.askTitular.ask.replace('<CPF>', context.state.titularCPF), await attach.getQR(flow.askTitular));
			break;
		case 'askMail':
			await context.sendText(flow.askMail.ask, await attach.getQR(flow.askMail));
			break;
		case 'gerarTicket':
			try {
				const { id } = context.state.ticketTypes.ticket_types.find((x) => x.ticket_type_id.toString() === context.state.ticketID.toString());
				await dialogs.createTicket(context,
					await assistenteAPI.postNewTicket(context.state.politicianData.organization_chatbot_id, context.session.user.id, id, await help.buildTicket(context.state)));
			} catch (error) {
				console.log('--\ncontext.state.ticketTypes.ticket_types', context.state.ticketTypes.ticket_types);
				console.log('context.state.ticketID', context.state.ticketID);
				await help.errorDetail(context, error);
			}
			break;
		case 'solicitacao7': // 'incidente'
			await context.setState({ incidenteAnonimo: false, titularFiles: [], fileTimerType: 7 });
			await attach.sendMsgFromAssistente(context, 'ticket_type_7', []);
			await context.sendText(flow.incidente.intro, await attach.getQR(flow.incidente));
			break;
		case 'incidenteA':
			await context.setState({ incidenteAnonimo: true });
			// falls throught
		case 'incidenteI':
		case 'incidenteAskFile':
			await context.setState({ titularFiles: [] }); // clean any past files
			await context.sendText(flow.incidente.askFile);
			break;
		case 'incidenteTitular':
			await context.sendText(flow.CPFConfirm.ask.replace('<CPF>', incidenteCPFAux[context.session.user.id]), await attach.getQRCPF(flow.CPFConfirm, flow.incidente.CPFNext));
			await context.setState({ titularCPF: incidenteCPFAux[context.session.user.id] }); // passing memory data to state
			delete incidenteCPFAux[context.session.user.id];
			break;
		case 'incidenteEmail':
			await context.sendText(flow.incidente.askMail, await attach.getQR(flow.askCPF));
			break;
		case 'gerarTicket7': {
			await context.setState({ ticketID: '7' });
			const { id } = context.state.ticketTypes.ticket_types.find((x) => x.ticket_type_id.toString() === context.state.ticketID);
			await dialogs.createTicket(context,
				await assistenteAPI.postNewTicket(context.state.politicianData.organization_chatbot_id, context.session.user.id, id, await help.buildTicket(context.state), '', 0, context.state.titularFiles));
		} break;
		case 'atendimentoAvançado':
			await dialogs.atendimentoAvançado(context);
			break;
		case 'sobreLGPD':
			await attach.sendMsgFromAssistente(context, 'sobre_lgpd', [flow.sobreLGPD.text1]);
			await context.typingOn();
			await context.sendVideo(flow.sobreLGPD.videoLink);
			await context.typingOff();
			await dialogs.sendMainMenu(context);
			break;
		case 'sobreDipiou':
			await attach.sendMsgFromAssistente(context, 'sobre_dipiou', [flow.sobreDipiou.text1]);
			await dialogs.sendMainMenu(context);
			break;
		case 'meuTicket':
			await dialogs.meuTicket(context);
			break;
		case 'cancelConfirmation':
			await context.setState({ currentTicket: await context.state.userTickets.tickets.find((x) => x.id.toString() === context.state.ticketID) });
			await context.sendText(flow.cancelConfirmation.confirm.replace('<TYPE>', context.state.currentTicket.type.name), await attach.getQR(flow.cancelConfirmation));
			break;
		case 'confirmaCancelamento':
			await dialogs.cancelTicket(context);
			break;
		case 'verTicketMsg':
			await dialogs.seeTicketMessages(context);
			break;
		case 'newTicketMsg':
			await dialogs.newTicketMessage(context);
			break;
		case 'createIssueDirect':
			await createIssue(context);
			break;
		case 'beginQuiz':
			await context.setState({ startedQuiz: true, typeQuiz: 'preparatory' });
			await context.sendText(flow.quiz.beginQuiz);
			// falls throught
		case 'startQuiz':
			await quiz.answerQuiz(context);
			break;
		case 'informacoes': {
			const buttons = await DF.buildInformacoesMenu(context);
			if (buttons) {
				await context.sendText(flow.informacoes.text1, buttons);
			} else {
				await context.sendText(flow.informacoes.text2, buttons);
				await timer.createInformacoesTimer(context.session.user.id, context);
			} }
			break;
		case 'infoRes': {
			const answer = context.state.infoRes[context.state.infoChoice];
			if (answer) {
				await help.sendTextAnswer(context, answer);
				await help.sendAttachment(context, answer);
			}
			await dialogs.sendMainMenu(context); }
			break;
		case 'testeAtendimento':
			await context.sendText(flow.solicitacoes.text1, await attach.getQR(flow.solicitacoes));
			break;
		case 'notificationOn':
			await assistenteAPI.updateBlacklistMA(context.session.user.id, 1);
			await assistenteAPI.logNotification(context.session.user.id, context.state.politicianData.user_id, 3);
			await context.sendText(flow.notifications.on);
			await dialogs.sendMainMenu(context);
			break;
		case 'notificationOff':
			await assistenteAPI.updateBlacklistMA(context.session.user.id, 0);
			await assistenteAPI.logNotification(context.session.user.id, context.state.politicianData.user_id, 4);
			await context.sendText(flow.notifications.off);
			await dialogs.sendMainMenu(context);
			break;
		case 'incidenteFilesTimer':
		case 'avançadoFilesTimer':
		case 'createFilesTimer':
			await timer.createFilesTimer(context.session.user.id, context); // time to wait for the uploaded files to enter as new events on facebook
			break;
		case 'end':
			// do something
			break;
		default:
			await dialogs.sendMainMenu(context);
			break;
		} // end switch case
	} catch (error) {
		await help.errorDetail(context, error);
	} // catch
};