// Google Apps Script for the form "IL Coverage/Time-Off Request".
// It sends each new response to the InoVA VA App, where admins approve or deny it.
//
// This file is not part of the app itself. Paste it into the form's script editor
// (in the form: three-dot menu > Apps Script). Setup steps are in README.md.

const APP_URL = 'https://inova-va-app.andres-261.workers.dev/api/form/time-off';

// Runs automatically when someone submits the form (after the trigger is added).
function onFormSubmit(e) {
  sendResponse_(e.response);
}

// Run this once by hand to send the responses that already exist.
// Responses the app already has are skipped. A response the app can't accept (for example an
// old one whose dates were typed as free text) is listed in the log, and the rest are still sent.
function sendAllResponses() {
  let sent = 0;
  let failed = 0;
  FormApp.getActiveForm().getResponses().forEach((response) => {
    try {
      sendResponse_(response);
      sent++;
    } catch (err) {
      failed++;
      console.log('Skipped the response from ' + response.getTimestamp() + ': ' + err.message);
    }
  });
  console.log('Done. Sent: ' + sent + '. Skipped: ' + failed + '.');
}

function sendResponse_(response) {
  const answers = response.getItemResponses();
  const titled = (words) => {
    const found = answers.find((a) => a.getItem().getTitle().toLowerCase().indexOf(words) !== -1);
    return found ? String(found.getResponse()) : '';
  };
  // The VA's name: the question titled "Name" (ignoring spaces, colons and other symbols),
  // or else the first question with "name" in its title that isn't about clients or businesses.
  const letters = (title) => title.toLowerCase().replace(/[^a-z]/g, '');
  const nameAnswer = answers.find((a) => letters(a.getItem().getTitle()) === 'name')
    || answers.find((a) => /name/i.test(a.getItem().getTitle()) && !/client|business/i.test(a.getItem().getTitle()));
  if (!nameAnswer) {
    console.log('Could not find the name question. Question titles: '
      + answers.map((a) => JSON.stringify(a.getItem().getTitle())).join(', '));
  }
  // The two date questions, in the order they appear on the form: start date, then end date.
  const dates = answers
    .filter((a) => a.getItem().getType() === FormApp.ItemType.DATE)
    .map((a) => String(a.getResponse()));

  const payload = {
    secret: PropertiesService.getScriptProperties().getProperty('APP_SECRET'),
    response_id: response.getId(),
    submitted_at: response.getTimestamp().toISOString(),
    name: nameAnswer ? String(nameAnswer.getResponse()) : '',
    start_date: dates[0] || '',
    end_date: dates[1] || dates[0] || '',
    clients: titled('client'),
    shift_times: titled('shift times'),
    template_filled: titled('coverage template'),
    notes: titled('extra notes'),
  };
  const result = UrlFetchApp.fetch(APP_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (result.getResponseCode() !== 200) {
    throw new Error('The VA App did not accept the response: ' + result.getResponseCode() + ' ' + result.getContentText());
  }
}
