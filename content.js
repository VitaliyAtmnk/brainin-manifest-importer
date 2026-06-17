(() => {
  'use strict';

  const PANEL_ID = 'brainin-manifest-importer-panel';
  const GENERATED_RECIPE_ROW_CLASS = 'bmi-generated-row';
  const GENERATED_PARTIAL_RESULT_ROW_CLASS = 'bmi-generated-partial-result-row';
  const UNKNOWN_TRANSLATION_FALLBACK = 'Neuvedeno';

  const CATEGORY_MAP = {
    'Memory': { id: '1', cs: 'Paměť' },
    'Concentration': { id: '2', cs: 'Koncentrace' },
    'Speech functions': { id: '3', cs: 'Řečové funkce' },
    'Logical thinking': { id: '4', cs: 'Logické myšlení' },
    'Spatial orientation': { id: '5', cs: 'Prostorová orientace' },
    'Light motor skills': { id: '6', cs: 'Lehká motorika' }
  };

  const INPUT_TYPE_TEXT = {
    1: 'Text',
    2: 'Číslo',
    3: 'Logická hodnota',
    6: 'Obrázek',
    7: 'Zvuk',
    8: 'Lokalizovaný text',
    9: 'Skupina otázek',
    10: 'Složka'
  };

  const OUTPUT_TYPE_TEXT = {
    1: 'Text',
    2: 'Číslo',
    3: 'Logická hodnota',
    4: 'JSON',
    5: 'Obrázek'
  };

  let loadedManifest = null;
  let isImportRunning = false;
  const translationCache = new Map();

  initialize();

  function initialize() {
    if (!isProgramManagePage())
      return;

    if (document.getElementById(PANEL_ID))
      return;

    const form = document.getElementById('programManageForm');
    if (!form)
      return;

    const panel = createPanel();
    form.parentElement.insertBefore(panel, form);

    form.addEventListener('submit', () => {
      try {
        synchronizePartialResultsHiddenInputFromRows();
      } catch (error) {
        console.warn('[BrainIn Manifest Importer] PartialResults synchronization failed before submit.', error);
      }
    });
  }

  function isProgramManagePage() {
    return /\/Program\/Manage\/\d+/i.test(window.location.pathname);
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;

    panel.innerHTML = `
      <div class="bmi-header">
        <span>BrainIn Manifest Importer</span>
        <span id="bmi-status-badge" class="bmi-badge">Ready</span>
      </div>
      <div class="bmi-body">
        <div class="bmi-row">
          <label for="bmi-manifest-file">Deployment manifest JSON</label>
          <input id="bmi-manifest-file" class="bmi-file-input form-control" type="file" accept="application/json,.json" />
          <button id="bmi-load-sample" class="bmi-button bmi-button-secondary" type="button">Clear</button>
        </div>

        <div class="bmi-row bmi-options">
          <label><input id="bmi-fill-program" type="checkbox" checked /> Fill program metadata</label>
          <label><input id="bmi-replace-inputs" type="checkbox" checked /> Replace input parameters</label>
          <label><input id="bmi-update-partial-results" type="checkbox" checked /> Update partial results</label>
          <label><input id="bmi-render-partial-result-rows" type="checkbox" checked /> Render partial result rows</label>
        </div>

        <div class="bmi-row">
          <button id="bmi-import" class="bmi-button bmi-button-success" type="button" disabled>Import manifest into form</button>
          <button id="bmi-preview-partial" class="bmi-button bmi-button-secondary" type="button" disabled>Preview PartialResults</button>
        </div>

        <div id="bmi-preview" class="bmi-preview">Select a deployment manifest JSON file.</div>
        <div id="bmi-log" class="bmi-log">No action yet.</div>
      </div>
    `;

    panel.querySelector('#bmi-manifest-file').addEventListener('change', onManifestFileSelected);
    panel.querySelector('#bmi-load-sample').addEventListener('click', clearLoadedManifest);
    panel.querySelector('#bmi-import').addEventListener('click', importManifestIntoForm);
    panel.querySelector('#bmi-preview-partial').addEventListener('click', previewPartialResults);

    return panel;
  }

  async function onManifestFileSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file)
      return;

    try {
      const text = await file.text();
      const manifest = JSON.parse(text);
      validateManifestShape(manifest);
      loadedManifest = manifest;
      setStatus('Manifest loaded');
      setLog('Manifest loaded successfully.', 'success');
      renderManifestPreview(manifest);
      setImportControlsEnabled(true);
    } catch (error) {
      loadedManifest = null;
      setImportControlsEnabled(false);
      setStatus('Invalid manifest');
      setLog(`Could not load manifest:\n${error.message}`, 'error');
      renderPreview('Invalid manifest.');
    }
  }

  function clearLoadedManifest() {
    loadedManifest = null;
    const fileInput = document.getElementById('bmi-manifest-file');
    if (fileInput)
      fileInput.value = '';

    setImportControlsEnabled(false);
    setStatus('Ready');
    renderPreview('Select a deployment manifest JSON file.');
    setLog('Cleared loaded manifest.');
  }

  function validateManifestShape(manifest) {
    if (!manifest || typeof manifest !== 'object')
      throw new Error('Manifest must be a JSON object.');

    if (!manifest.program || !manifest.program.name)
      throw new Error('Manifest does not contain program.name.');

    if (!manifest.inputContract || !Array.isArray(manifest.inputContract.parameters))
      throw new Error('Manifest does not contain inputContract.parameters.');

    if (!manifest.outputContract || !Array.isArray(manifest.outputContract.roundCustomData))
      throw new Error('Manifest does not contain outputContract.roundCustomData.');
  }

  function renderManifestPreview(manifest) {
    const inputParameters = manifest.inputContract.parameters || [];
    const roundOutputs = manifest.outputContract.roundCustomData || [];
    const globalOutputs = manifest.outputContract.globalOutputs || [];

    const inputPreview = inputParameters
      .map(parameter => `  - ${parameter.key} (${parameter.brainInDataType || parameter.brainInDataTypeId}, default: ${parameter.defaultValue ?? ''})`)
      .join('\n');

    const outputPreview = roundOutputs
      .map(parameter => `  - ${parameter.key} (${parameter.brainInDataType || parameter.brainInDataTypeId})`)
      .join('\n');

    renderPreview(
      `Program: ${manifest.program.name}\n` +
      `Category: ${manifest.program.category || '-'}\n` +
      `Inputs: ${inputParameters.length}\n${inputPreview || '  - none'}\n\n` +
      `Round customData outputs: ${roundOutputs.length}\n${outputPreview || '  - none'}\n\n` +
      `Global outputs: ${globalOutputs.length}\n\n` +
      `Save is not automatic. Review the form and click Uložit manually.`
    );
  }

  async function importManifestIntoForm() {
    if (!loadedManifest || isImportRunning)
      return;

    isImportRunning = true;
    setImportControlsEnabled(false);
    setStatus('Importing...');
    setLog('Starting import...');

    try {
      const options = readImportOptions();
      const programId = getProgramId();
      const translationIds = await prepareTranslations(loadedManifest, options);

      if (options.fillProgram)
        fillProgramMetadata(loadedManifest, translationIds);

      if (options.replaceInputs)
        fillInputParameters(loadedManifest, translationIds, programId);

      if (options.updatePartialResults)
        fillPartialResults(loadedManifest, translationIds, options.renderPartialResultRows);

      triggerFormChanged();

      setStatus('Imported');
      setLog(
        'Import finished successfully. Review the generated values and click Uložit manually.\n\n' +
        `Created/reused translations: ${translationIds.size}\n` +
        `Input rows: ${(loadedManifest.inputContract.parameters || []).length}\n` +
        `Round customData outputs: ${(loadedManifest.outputContract.roundCustomData || []).length}`,
        'success'
      );
    } catch (error) {
      console.error('[BrainIn Manifest Importer]', error);
      setStatus('Import failed');
      setLog(`Import failed:\n${error.stack || error.message}`, 'error');
    } finally {
      isImportRunning = false;
      setImportControlsEnabled(Boolean(loadedManifest));
    }
  }

  function readImportOptions() {
    return {
      fillProgram: document.getElementById('bmi-fill-program')?.checked === true,
      replaceInputs: document.getElementById('bmi-replace-inputs')?.checked === true,
      updatePartialResults: document.getElementById('bmi-update-partial-results')?.checked === true,
      renderPartialResultRows: document.getElementById('bmi-render-partial-result-rows')?.checked === true
    };
  }

  async function prepareTranslations(manifest, options) {
    const requests = [];

    if (options.fillProgram) {
      const description = localizedTextFromObject(manifest.program?.description, manifest.program?.name || 'Program description');
      requests.push({ key: 'program.description', text: description });
    }

    if (options.replaceInputs) {
      for (const parameter of manifest.inputContract.parameters || []) {
        requests.push({ key: translationKey('input', parameter.key, 'name'), text: localizedName(parameter) });
        requests.push({ key: translationKey('input', parameter.key, 'description'), text: localizedDescription(parameter) });
      }
    }

    if (options.updatePartialResults) {
      for (const parameter of manifest.outputContract.roundCustomData || []) {
        requests.push({ key: translationKey('roundOutput', parameter.key, 'name'), text: localizedName(parameter) });
        requests.push({ key: translationKey('roundOutput', parameter.key, 'description'), text: localizedDescription(parameter) });
      }
    }

    const result = new Map();

    for (const request of requests) {
      const id = await getOrCreateTranslation(request.text);
      result.set(request.key, id);
      appendLogLine(`Translation: ${request.text.cs} -> ${id}`);
    }

    return result;
  }

  function fillProgramMetadata(manifest, translationIds) {
    setInputValueBySelector('#Name', manifest.program.name || '');

    const descriptionId = translationIds.get('program.description');
    if (descriptionId) {
      setInputValueBySelector('#programDescriptionElementForId_Id', String(descriptionId));
      setInputValueBySelector('#programDescriptionElementForText_Id', manifest.program.description?.cs || manifest.program.name || '');
    }

    if (manifest.program.category)
      setCategory(manifest.program.category);
  }

  function setCategory(categoryName) {
    const category = CATEGORY_MAP[categoryName];
    const input = document.getElementById('CategoriesIds');

    if (!category || !input)
      return;

    input.value = category.id;

    if (window.jQuery && window.jQuery.fn && window.jQuery.fn.select2) {
      try {
        window.jQuery(input).select2('data', [{ id: category.id, text: category.cs, name: category.cs }]);
        window.jQuery(input).trigger('change');
      } catch (_) {
        // Ignore select2 visual update failure. The hidden value is the important part for submit.
      }
    }
  }

  function fillInputParameters(manifest, translationIds, programId) {
    const wrapper = document.getElementById('RecipeRowsDivWrapper');
    if (!wrapper)
      throw new Error('RecipeRowsDivWrapper was not found.');

    removeExistingRecipeRows(wrapper);

    const parameters = manifest.inputContract.parameters || [];

    parameters.forEach((parameter, index) => {
      const nameTranslationId = translationIds.get(translationKey('input', parameter.key, 'name'));
      const descriptionTranslationId = translationIds.get(translationKey('input', parameter.key, 'description'));

      if (!nameTranslationId || !descriptionTranslationId)
        throw new Error(`Missing translation id for input parameter ${parameter.key}.`);

      const row = createRecipeRow({
        programId,
        rowNumber: index,
        key: parameter.key,
        nameText: localizedName(parameter).cs,
        descriptionText: localizedDescription(parameter).cs,
        nameTranslationId,
        descriptionTranslationId,
        dataTypeId: parameter.brainInDataTypeId || 1,
        defaultValue: parameter.defaultValue ?? '',
        isSecondary: false
      });

      const addButtonContainer = wrapper.querySelector('.form-group.text-center');
      if (addButtonContainer)
        wrapper.insertBefore(row, addButtonContainer);
      else
        wrapper.appendChild(row);
    });
  }

  function removeExistingRecipeRows(wrapper) {
    wrapper.querySelectorAll('.recipeRowDiv').forEach(row => row.remove());
    wrapper.querySelectorAll(`.${GENERATED_RECIPE_ROW_CLASS}`).forEach(row => row.remove());
  }

  function createRecipeRow(options) {
    const token = createUuid();
    const guid = createUuid();
    const fieldPrefix = `ProgramRecipeViewModels[${token}]`;
    const idPrefix = `ProgramRecipeViewModels_${token}`;
    const typeText = INPUT_TYPE_TEXT[Number(options.dataTypeId)] || String(options.dataTypeId);
    const isChecked = options.isSecondary ? 'checked="checked"' : '';

    const row = document.createElement('div');
    row.className = `recipeRowDiv ${GENERATED_RECIPE_ROW_CLASS}`;
    row.dataset.braininManifestKey = options.key;

    row.innerHTML = `
      <input type="hidden" name="ProgramRecipeViewModels.index" autocomplete="off" value="${escapeAttribute(token)}">
      <input type="hidden" class="guid" value="${escapeAttribute(guid)}">
      <input type="hidden" id="${escapeAttribute(idPrefix)}__Id" name="${escapeAttribute(fieldPrefix)}.Id" value="0">
      <input type="hidden" id="${escapeAttribute(idPrefix)}__RowNumber" name="${escapeAttribute(fieldPrefix)}.RowNumber" value="${escapeAttribute(String(options.rowNumber))}">
      <input type="hidden" id="${escapeAttribute(idPrefix)}__ProgramId" name="${escapeAttribute(fieldPrefix)}.ProgramId" value="${escapeAttribute(String(options.programId))}">

      <div class="row">
        <div class="col-md-12 form-row">
          <div class="col-md-2">
            <input id="RowNameIdName-${escapeAttribute(guid)}" name="${escapeAttribute(fieldPrefix)}.RowNameIdName" type="hidden" value="${escapeAttribute(options.nameText)}">
            <input class="form-control form-control-sm" id="RowNameId-${escapeAttribute(guid)}" name="${escapeAttribute(fieldPrefix)}.TranslationNameViewModel.Id" type="text" value="${escapeAttribute(String(options.nameTranslationId))}" title="${escapeAttribute(options.nameText)}">
            <small>${escapeHtml(options.nameText)}</small>
          </div>
          <div class="col-md-3">
            <input id="RowDescriptionIdName-${escapeAttribute(guid)}" name="${escapeAttribute(fieldPrefix)}.RowDescriptionIdName" type="hidden" value="${escapeAttribute(options.descriptionText)}">
            <input class="form-control form-control-sm" id="RowDescriptionId-${escapeAttribute(guid)}" name="${escapeAttribute(fieldPrefix)}.TranslationDescriptionViewModel.Id" type="text" value="${escapeAttribute(String(options.descriptionTranslationId))}" title="${escapeAttribute(options.descriptionText)}">
            <small>${escapeHtml(options.descriptionText)}</small>
          </div>
          <div class="col-md-2">
            <select class="form-control form-control-sm" id="ProgramTypeIdSelect-${escapeAttribute(guid)}" name="${escapeAttribute(fieldPrefix)}.DataTypeId" title="Typ dat">
              ${createInputTypeOptions(options.dataTypeId)}
            </select>
            <small>${escapeHtml(typeText)}</small>
          </div>
          <div class="col-md-2">
            <input class="form-control-sm form-control" id="ProgramValue-${escapeAttribute(guid)}" name="${escapeAttribute(fieldPrefix)}.Value" title="Výchozí hodnota" type="text" value="${escapeAttribute(String(options.defaultValue ?? ''))}">
          </div>
          <div class="col-md-1">
            <input class="form-control form-control-sm" id="${escapeAttribute(idPrefix)}__Label" name="${escapeAttribute(fieldPrefix)}.Label" title="${escapeAttribute(options.key)}" type="text" value="${escapeAttribute(options.key)}">
          </div>
          <div class="col-md-1" style="text-align: center">
            <input class="form-control-cb" id="ProgramSecondary-${escapeAttribute(guid)}" name="${escapeAttribute(fieldPrefix)}.IsSecondary" title="Vedlejší" type="checkbox" value="true" ${isChecked}>
            <input name="${escapeAttribute(fieldPrefix)}.IsSecondary" type="hidden" value="false">
          </div>
          <div class="col-md-1">
            <button class="btn btn-danger btn-sm bmi-remove-generated-row" type="button">Smazat</button>
          </div>
        </div>
      </div>
    `;

    row.querySelector('.bmi-remove-generated-row').addEventListener('click', () => row.remove());
    return row;
  }

  function createInputTypeOptions(selectedTypeId) {
    return Object.entries(INPUT_TYPE_TEXT)
      .map(([id, text]) => {
        const selected = Number(id) === Number(selectedTypeId) ? ' selected="selected"' : '';
        return `<option value="${escapeAttribute(id)}"${selected}>${escapeHtml(text)}</option>`;
      })
      .join('');
  }

  function fillPartialResults(manifest, translationIds, renderRows) {
    const partialResultsInput = document.getElementById('PartialResults');
    if (!partialResultsInput)
      throw new Error('PartialResults hidden input was not found.');

    const existingResults = parsePartialResults(partialResultsInput.value);
    const customOutputs = manifest.outputContract.roundCustomData || [];
    const customLabels = new Set(customOutputs.map(output => output.key));
    const preservedResults = existingResults.filter(result => !customLabels.has(result.label));
    const generatedResults = [];

    for (const output of customOutputs) {
      const nameTranslationId = translationIds.get(translationKey('roundOutput', output.key, 'name'));
      const descriptionTranslationId = translationIds.get(translationKey('roundOutput', output.key, 'description'));

      if (!nameTranslationId || !descriptionTranslationId)
        throw new Error(`Missing translation id for output parameter ${output.key}.`);

      generatedResults.push({
        name: Number(nameTranslationId),
        description: Number(descriptionTranslationId),
        label: output.key,
        type: Number(output.brainInDataTypeId || 1),
        required: output.required === false ? 0 : 1,
        nameText: localizedName(output).cs,
        descriptionText: localizedDescription(output).cs
      });
    }

    partialResultsInput.value = JSON.stringify(
      preservedResults.concat(generatedResults.map(stripPartialResultViewOnlyFields))
    );
    partialResultsInput.dispatchEvent(new Event('change', { bubbles: true }));

    if (renderRows)
      renderPartialResultRows(customLabels, generatedResults);
  }

  function stripPartialResultViewOnlyFields(result) {
    return {
      name: Number(result.name),
      description: Number(result.description),
      label: result.label,
      type: Number(result.type || 1),
      required: Number(result.required ?? 1)
    };
  }

  function renderPartialResultRows(customLabels, generatedResults) {
    const wrapper = getPartialResultRowsContainer();
    if (!wrapper)
      throw new Error('Partial result rows container was not found.');

    removeGeneratedPartialResultRows(customLabels);

    const addButtonRow = document.getElementById('AddNewPartialResultRow')?.closest('.row');

    for (const result of generatedResults) {
      const row = createPartialResultRow(result);

      if (addButtonRow && addButtonRow.parentElement === wrapper)
        wrapper.insertBefore(row, addButtonRow);
      else
        wrapper.appendChild(row);
    }

    synchronizePartialResultsHiddenInputFromRows();
  }

  function getPartialResultRowsContainer() {
    const explicitWrapper = document.getElementById('PartialResultRowWrapper');
    if (explicitWrapper)
      return explicitWrapper;

    const addButtonRow = document.getElementById('AddNewPartialResultRow')?.closest('.row');
    if (addButtonRow && addButtonRow.parentElement)
      return addButtonRow.parentElement;

    return document.getElementById('programResult');
  }

  function removeGeneratedPartialResultRows(customLabels) {
    document.querySelectorAll(`.${GENERATED_PARTIAL_RESULT_ROW_CLASS}`).forEach(row => row.remove());

    document.querySelectorAll('.partialResultRowDiv').forEach(row => {
      const label = row.querySelector('.partialResultLabel')?.value;
      if (label && customLabels.has(label))
        row.remove();
    });
  }

  function createPartialResultRow(result) {
    const guid = createUuid();
    const typeText = OUTPUT_TYPE_TEXT[Number(result.type)] || String(result.type);

    const row = document.createElement('div');
    row.className = `partialResultRowDiv ${GENERATED_PARTIAL_RESULT_ROW_CLASS}`;
    row.dataset.braininManifestKey = result.label;

    row.innerHTML = `
      <div class="row">
        <div class="col-md-12 form-row">
          <div class="col-md-3">
            <input class="partialResultName form-control form-control-sm" id="partialResultName-${escapeAttribute(guid)}" name="item.Name" title="${escapeAttribute(result.nameText)}" type="text" value="${escapeAttribute(String(result.name))}">
            <small>${escapeHtml(result.nameText)}</small>
          </div>
          <div class="col-md-4">
            <input class="partialResultDescription form-control form-control-sm" id="partialResultDescription-${escapeAttribute(guid)}" name="item.Description" title="${escapeAttribute(result.descriptionText)}" type="text" value="${escapeAttribute(String(result.description))}">
            <small>${escapeHtml(result.descriptionText)}</small>
          </div>
          <div class="col-md-2">
            <input class="partialResultLabel form-control form-control-sm" id="partialResultLabel-${escapeAttribute(guid)}" name="item.Label" title="${escapeAttribute(result.label)}" type="text" value="${escapeAttribute(result.label)}">
          </div>
          <div class="col-md-2">
            <select class="partialResultType form-control form-control-sm" id="partialResultType-${escapeAttribute(guid)}" name="item.Type" title="Typ dat">
              ${createOutputTypeOptions(result.type)}
            </select>
            <small>${escapeHtml(typeText)}</small>
          </div>
          <div class="col-md-1">
            <button class="btn btn-danger btn-sm bmi-remove-generated-row" type="button">Smazat</button>
          </div>
          <input class="partialResultRequired" id="partialResultRequired-${escapeAttribute(guid)}" name="item.Required" title="Required" type="hidden" value="${escapeAttribute(String(result.required ?? 1))}">
        </div>
      </div>
    `;

    row.querySelector('.bmi-remove-generated-row').addEventListener('click', () => {
      row.remove();
      synchronizePartialResultsHiddenInputFromRows();
    });

    row.querySelectorAll('input, select').forEach(element => {
      element.addEventListener('change', synchronizePartialResultsHiddenInputFromRows);
      element.addEventListener('input', synchronizePartialResultsHiddenInputFromRows);
    });

    return row;
  }

  function createOutputTypeOptions(selectedTypeId) {
    return Object.entries(OUTPUT_TYPE_TEXT)
      .map(([id, text]) => {
        const selected = Number(id) === Number(selectedTypeId) ? ' selected="selected"' : '';
        return `<option value="${escapeAttribute(id)}"${selected}>${escapeHtml(text)}</option>`;
      })
      .join('');
  }

  function synchronizePartialResultsHiddenInputFromRows() {
    const input = document.getElementById('PartialResults');
    if (!input)
      return;

    const rows = Array.from(document.querySelectorAll('.partialResultRowDiv'));
    const results = rows
      .map(readPartialResultRow)
      .filter(Boolean);

    if (results.length === 0)
      return;

    input.value = JSON.stringify(results);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function readPartialResultRow(row) {
    const name = row.querySelector('.partialResultName')?.value;
    const description = row.querySelector('.partialResultDescription')?.value;
    const label = row.querySelector('.partialResultLabel')?.value;
    const type = row.querySelector('.partialResultType')?.value;
    const required = row.querySelector('.partialResultRequired')?.value;

    if (!label)
      return null;

    return {
      name: Number(name || 0),
      description: Number(description || 0),
      label: label,
      type: Number(type || 1),
      required: Number(required || 1)
    };
  }

  function parsePartialResults(value) {
    if (!value || !value.trim())
      return [];

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      throw new Error(`PartialResults does not contain valid JSON: ${error.message}`);
    }
  }

  function previewPartialResults() {
    const input = document.getElementById('PartialResults');
    if (!input) {
      setLog('PartialResults hidden input was not found.', 'error');
      return;
    }

    try {
      const parsed = parsePartialResults(input.value);
      renderPreview(JSON.stringify(parsed, null, 2));
    } catch (error) {
      setLog(error.message, 'error');
    }
  }

  async function getOrCreateTranslation(text) {
    const normalized = normalizeLocalizedText(text);
    const cacheKey = `${normalized.cs}|${normalized.en}|${normalized.de}`;

    if (translationCache.has(cacheKey))
      return translationCache.get(cacheKey);

    const existing = await findTranslation(normalized.cs);
    if (existing) {
      translationCache.set(cacheKey, existing.id);
      return existing.id;
    }

    await createTranslation(normalized);

    const created = await waitForTranslation(normalized.cs, 5000);
    if (!created)
      throw new Error(`Translation was created but could not be found afterwards: ${normalized.cs}`);

    translationCache.set(cacheKey, created.id);
    return created.id;
  }

  async function findTranslation(query) {
    const url = getTranslationSearchUrl();
    const body = new URLSearchParams();
    body.set('query', query || '');

    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body
    });

    if (!response.ok)
      throw new Error(`Translation search failed: HTTP ${response.status}`);

    const data = await response.json();
    const items = Array.isArray(data) ? data : [];
    const exact = items.find(item => normalizeText(item.name) === normalizeText(query));

    if (exact)
      return { id: exact.id, name: exact.name };

    return null;
  }

  async function createTranslation(text) {
    const modalCreated = await tryCreateTranslationUsingExistingModal(text);
    if (modalCreated)
      return;

    await createTranslationUsingDirectPost(text);
  }

  async function tryCreateTranslationUsingExistingModal(text) {
    const button = document.getElementById('createNewTranslation');
    if (!button)
      return false;

    button.click();

    const dialog = await waitForElement('#CreateNewTranslationDialog', 3500);
    if (!dialog)
      return false;

    setInputValueBySelector('#CreateNewTranslationDialog #Cz', text.cs);
    setInputValueBySelector('#CreateNewTranslationDialog #En', text.en);
    setInputValueBySelector('#CreateNewTranslationDialog #De', text.de);

    const submit = document.querySelector('#CreateNewTranslationDialog #submitLocalizedStringTypeForm');
    if (!submit)
      return false;

    submit.click();
    await delay(700);
    return true;
  }

  async function createTranslationUsingDirectPost(text) {
    const url = getTranslationCreateUrl();
    const body = new URLSearchParams();
    body.set('Id', '0');
    body.set('DbColumnName', createUuid());
    body.set('Cz', text.cs);
    body.set('En', text.en);
    body.set('De', text.de);

    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body
    });

    if (!response.ok)
      throw new Error(`Translation create failed: HTTP ${response.status}`);

    await response.text();
  }

  async function waitForTranslation(czText, timeoutMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const found = await findTranslation(czText);
      if (found)
        return found;

      await delay(300);
    }

    return null;
  }

  function getTranslationSearchUrl() {
    if (window.Router && typeof window.Router.action === 'function')
      return window.Router.action('Translation', 'GetTranslations');

    return '/Translation/GetTranslations';
  }

  function getTranslationCreateUrl() {
    return '/Translation/CreateFromModal2';
  }

  function localizedName(parameter) {
    return localizedTextFromObject(parameter.displayName, parameter.key || UNKNOWN_TRANSLATION_FALLBACK);
  }

  function localizedDescription(parameter) {
    return localizedTextFromObject(parameter.description, parameter.key || UNKNOWN_TRANSLATION_FALLBACK);
  }

  function localizedTextFromObject(value, fallback) {
    const fallbackText = fallback || UNKNOWN_TRANSLATION_FALLBACK;

    if (!value || typeof value !== 'object') {
      return normalizeLocalizedText({
        cs: fallbackText,
        en: fallbackText,
        de: fallbackText
      });
    }

    return normalizeLocalizedText({
      cs: value.cs || fallbackText,
      en: value.en || value.cs || fallbackText,
      de: value.de || value.en || value.cs || fallbackText
    });
  }

  function normalizeLocalizedText(text) {
    return {
      cs: normalizeNonEmpty(text.cs, UNKNOWN_TRANSLATION_FALLBACK),
      en: normalizeNonEmpty(text.en, text.cs || UNKNOWN_TRANSLATION_FALLBACK),
      de: normalizeNonEmpty(text.de, text.en || text.cs || UNKNOWN_TRANSLATION_FALLBACK)
    };
  }

  function normalizeNonEmpty(value, fallback) {
    const text = String(value ?? '').trim();
    return text.length > 0 ? text : String(fallback ?? UNKNOWN_TRANSLATION_FALLBACK);
  }

  function translationKey(scope, key, kind) {
    return `${scope}.${key}.${kind}`;
  }

  function getProgramId() {
    const idInput = document.getElementById('Id');
    if (!idInput || !idInput.value)
      throw new Error('Program Id hidden input was not found.');

    return idInput.value;
  }

  function setInputValueBySelector(selector, value) {
    const element = document.querySelector(selector);
    if (!element)
      return;

    if ('value' in element)
      element.value = value ?? '';
    else
      element.textContent = value ?? '';

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function triggerFormChanged() {
    const form = document.getElementById('programManageForm');
    if (!form)
      return;

    form.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setImportControlsEnabled(enabled) {
    const importButton = document.getElementById('bmi-import');
    const partialPreviewButton = document.getElementById('bmi-preview-partial');

    if (importButton)
      importButton.disabled = !enabled || isImportRunning;

    if (partialPreviewButton)
      partialPreviewButton.disabled = !enabled || isImportRunning;
  }

  function setStatus(text) {
    const element = document.getElementById('bmi-status-badge');
    if (element)
      element.textContent = text;
  }

  function renderPreview(text) {
    const element = document.getElementById('bmi-preview');
    if (element)
      element.textContent = text;
  }

  function setLog(text, type = '') {
    const element = document.getElementById('bmi-log');
    if (!element)
      return;

    element.textContent = text;
    element.classList.remove('bmi-error', 'bmi-success');

    if (type === 'error')
      element.classList.add('bmi-error');
    else if (type === 'success')
      element.classList.add('bmi-success');
  }

  function appendLogLine(line) {
    const element = document.getElementById('bmi-log');
    if (!element)
      return;

    const current = element.textContent || '';
    element.textContent = current ? `${current}\n${line}` : line;
    element.scrollTop = element.scrollHeight;
  }

  function waitForElement(selector, timeoutMs) {
    return new Promise(resolve => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(element);
        }
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function createUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function')
      return window.crypto.randomUUID();

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
      const random = Math.random() * 16 | 0;
      const value = character === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function normalizeText(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
