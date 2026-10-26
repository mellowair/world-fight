import fs from 'node:fs';const p='stage3.test.js';let s=fs.readFileSync(p,'utf8');const old=`    if (campaign.status === "event") {
      const choice = campaign.pendingEvent.data.skillChoices?.[0] ?? null;
      resolveCampaignEvent(campaign, choice ?? (campaign.activeEventType === "campfire" ? "rest" : null));
      completeLocation(campaign);`;const next=`    if (campaign.status === "event") {
      const event = campaign.pendingEvent;
      const choice = event?.data?.skillChoices?.[0]
        ?? (event?.eventId === "sea_beyond" ? "sea_pass" : null)
        ?? (event?.eventId === "death_note" ? "death_note_pass" : null)
        ?? (event?.eventId === "fate_gate" ? "fate_accept" : null)
        ?? (campaign.activeEventType === "campfire" ? "rest" : null);
      resolveCampaignEvent(campaign, choice);
      completeLocation(campaign);`;if(!s.includes(old))throw Error('stage3 event helper target not found');fs.writeFileSync(p,s.replace(old,next),'utf8');
