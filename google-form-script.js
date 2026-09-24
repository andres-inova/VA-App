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
// Responses the app already has are skipped.
function sendAllResponses() {
  FormApp.getActiveForm().getResponses().forEach(sendResponse_);
}

function sendResponse_(response) {
  const answers = response.getItemResponses();
  const titled = (words) => {
    const found = answers.find((a) => a.getItem().getTitle().toLowerCase().indexOf(words) !== -1);
    return found ? String(found.getResponse()) : '';
  };
  const exact = (title) => {
    const found = answers.find((a) => a.getItem().getTitle().trim().toLowerCase() === title);
    return found ? String(found.getResponse()) : '';
  };
  // The two date questions, in the order they appear on the form: start date, then end date.
  const dates = answers
    .filter((a) => a.getItem().getType() === FormApp.ItemType.DATE)
    .map((a) => String(a.getResponse()));

  const payload = {
    secret: PropertiesService.getScriptProperties().getProperty('APP_SECRET'),
    response_id: response.getId(),
    submitted_at: response.getTimestamp().toISOString(),
    name: exact('name'),
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
