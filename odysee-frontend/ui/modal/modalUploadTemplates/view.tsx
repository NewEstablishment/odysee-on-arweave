import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import React from 'react';
import { v4 as uuid } from 'uuid';
import { Modal } from 'modal/modal';
import Card from 'component/common/card';
import Button from 'component/button';
import { FormField } from 'component/common/form';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import { getUploadTemplatesFromSettings } from 'util/homepage-settings';
import { cloneDeep } from 'util/clone';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectActiveChannelId } from 'redux/selectors/app';
import { selectMyChannelClaims } from 'redux/selectors/claims';
import { selectSettingsByChannelId } from 'redux/selectors/comments';
import { doFetchCreatorSettings, doUpdateCreatorSettings } from 'redux/actions/comments';
import { doUpdatePublishForm } from 'redux/actions/publish';
import { doToast } from 'redux/actions/notifications';
import { doHideModal } from 'redux/actions/app';
import { SECTION_CLASSES } from 'component/common/section-classes';

type TemplateEntry = UploadTemplate & {
  channelId: string;
  channelName: string;
};

const TEMPLATE_SEARCH_THRESHOLD = 6;
const TEMPLATE_TEXT_BUTTON_CLASS_NAME =
  'tw:inline-flex tw:h-[32px] tw:cursor-pointer tw:items-center tw:justify-center tw:gap-app-xxxs tw:whitespace-nowrap tw:rounded-app tw:border tw:px-app-s tw:py-0 tw:text-app-small tw:text-app-text';
const TEMPLATE_TEXT_BUTTON_DEFAULT_CLASS_NAME =
  'tw:border-app-border tw:bg-transparent tw:hover:bg-[rgba(var(--color-primary-dynamic),0.1)]';
const TEMPLATE_ACTION_BUTTON_CLASS_NAME =
  'tw:inline-flex tw:size-[32px] tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-app tw:border tw:border-app-border tw:bg-transparent tw:text-app-text tw:hover:bg-[rgba(var(--color-primary-dynamic),0.1)] tw:disabled:cursor-not-allowed tw:disabled:opacity-40';

function makeDuplicateTemplateName(name: string, existingTemplates: Array<UploadTemplate>): string {
  const baseName = (name || __('Template')).trim();

  const existingNames = new Set(existingTemplates.map((template) => template.name.toLowerCase()));

  const copyLabel = __('Copy');

  let candidate = `${baseName} (${copyLabel})`;
  let suffix = 2;

  while (existingNames.has(candidate.toLowerCase())) {
    candidate = `${baseName} (${copyLabel} ${suffix})`;
    suffix += 1;
  }

  return candidate;
}

function getTemplateSortTimestamp(template: UploadTemplate): number {
  return Number(template.lastUsedAt || template.createdAt || 0);
}

function getTemplateFingerprint(template: UploadTemplate): string {
  return `${template.id}|${template.name}|${Number(template.createdAt || 0)}|${Number(template.lastUsedAt || 0)}|${template.isPinned ? 1 : 0}|${JSON.stringify(template.data || {})}`;
}

function areTemplateArraysEqual(a: Array<UploadTemplate>, b: Array<UploadTemplate>): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (getTemplateFingerprint(a[i]) !== getTemplateFingerprint(b[i])) {
      return false;
    }
  }

  return true;
}

function getTemplateKey(channelId: string, templateId: string): string {
  return `${channelId}:${templateId}`;
}

function getDateLabel(timestamp: number | null | undefined): string {
  const time = Number(timestamp || 0);
  if (!time) return __('Unknown');
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? __('Unknown') : date.toLocaleDateString();
}

function truncatePreviewValue(value: string, maxLength: number = 40): string {
  if (!value) return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatPrice(price: any): string {
  if (!price || typeof price !== 'object') return '';

  if (price.amount && price.currency) {
    return `${price.amount} ${price.currency}`;
  }

  return '';
}

function getNormalizedPaywall(paywall: any): string {
  return typeof paywall === 'string' ? paywall.trim().toLowerCase() : '';
}

function hasEnabledPriceDetails(templateData: UploadTemplateData): boolean {
  const data: UploadTemplateData = templateData || ({} as UploadTemplateData);
  const normalizedPaywall = getNormalizedPaywall(data.paywall);
  const hasSdkPrice = Number(data?.fee?.amount || 0) > 0;
  const hasFiatPurchase = Boolean(data.fiatPurchaseEnabled && Number(data?.fiatPurchaseFee?.amount || 0) > 0);
  const hasFiatRental = Boolean(data.fiatRentalEnabled && Number(data?.fiatRentalFee?.amount || 0) > 0);
  if (normalizedPaywall === 'sdk') return hasSdkPrice;
  if (normalizedPaywall === 'fiat') return hasFiatPurchase || hasFiatRental;

  // Backward-compatibility for older templates that may not have saved `paywall`.
  if (!normalizedPaywall) {
    return hasSdkPrice || hasFiatPurchase || hasFiatRental;
  }

  return false;
}

function getTagsLabel(tags: any): string {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  return tags
    .map((tag) => {
      if (typeof tag === 'string') return tag;
      if (tag && typeof tag === 'object' && typeof tag.name === 'string') return tag.name;
      return '';
    })
    .filter(Boolean)
    .join(', ');
}

function getTemplatePreviewFields(templateData: UploadTemplateData): Array<{
  label: string;
  value: string;
}> {
  const data: UploadTemplateData = templateData || ({} as UploadTemplateData);
  const fields = [];
  if (data.title)
    fields.push({
      label: __('Title'),
      value: String(data.title),
    });
  if (data.description)
    fields.push({
      label: __('Description'),
      value: String(data.description),
    });
  const tagsLabel = getTagsLabel(data.tags);
  if (tagsLabel)
    fields.push({
      label: __('Tags'),
      value: tagsLabel,
    });

  if (data.language) {
    fields.push({
      label: __('Language'),
      value: String(data.language),
    });
  } else {
    const languages = data.languages;

    if (languages && Array.isArray(languages) && languages.length > 0) {
      fields.push({
        label: __('Languages'),
        value: languages.join(', '),
      });
    }
  }

  if (data.visibility)
    fields.push({
      label: __('Visibility'),
      value: String(data.visibility),
    });
  if (data.nsfw === true)
    fields.push({
      label: __('Mature'),
      value: __('Yes'),
    });
  if (data.licenseType)
    fields.push({
      label: __('License'),
      value: String(data.licenseType),
    });
  const normalizedPaywall = getNormalizedPaywall(data.paywall);
  const shouldShowPriceDetails = hasEnabledPriceDetails(data);

  if (shouldShowPriceDetails) {
    const feeLabel = formatPrice(data.fee);

    if (feeLabel && (normalizedPaywall === 'sdk' || !normalizedPaywall)) {
      fields.push({
        label: __('Price'),
        value: feeLabel,
      });
    }

    if (normalizedPaywall && normalizedPaywall !== 'free') {
      fields.push({
        label: __('Paywall'),
        value: String(data.paywall),
      });
    }
  }

  if (typeof data.memberRestrictionOn === 'boolean') {
    fields.push({
      label: __('Members'),
      value: data.memberRestrictionOn ? __('Restricted') : __('Off'),
    });
  }

  if (data.thumbnail)
    fields.push({
      label: __('Thumbnail'),
      value: __('Set'),
    });
  return fields;
}

function getTemplateSearchText(template: TemplateEntry): string {
  const previewFieldValues = getTemplatePreviewFields(template.data || {})
    .map((field) => field.value)
    .join(' ');
  return `${template.name || ''} ${template.channelName || ''} ${previewFieldValues}`.toLowerCase();
}

export default function ModalUploadTemplates() {
  const dispatch = useAppDispatch();
  const defaultChannelId = useAppSelector(selectActiveChannelId) || '';
  const myChannelClaims = (useAppSelector(selectMyChannelClaims) || []) as Array<ChannelClaim>;
  const settingsByChannelId = useAppSelector(selectSettingsByChannelId) || {};

  const fetchCreatorSettings = React.useCallback(
    (channelId: string) => dispatch(doFetchCreatorSettings(channelId)),
    [dispatch]
  );
  const updatePublishForm = React.useCallback((values: any) => dispatch(doUpdatePublishForm(values)), [dispatch]);

  const [requestedSettingsByChannelId, setRequestedSettingsByChannelId] = React.useState<Record<string, boolean>>({});
  const [editingTemplateKey, setEditingTemplateKey] = React.useState<string | null | undefined>(null);
  const [editName, setEditName] = React.useState('');
  const [editInputName, setEditInputName] = React.useState(`rename_template_${uuid()}`);
  const [expandedPreviewByTemplateKey, setExpandedPreviewByTemplateKey] = React.useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = React.useState('');
  const [hasLocalEdits, setHasLocalEdits] = React.useState(false);
  const orderedChannelClaims = React.useMemo((): Array<ChannelClaim> => {
    const seenById: Record<string, boolean> = {};
    const channels: Array<ChannelClaim> = [];
    (myChannelClaims || []).forEach((channelClaim) => {
      if (!channelClaim || !channelClaim.claim_id || seenById[channelClaim.claim_id]) {
        return;
      }

      seenById[channelClaim.claim_id] = true;
      channels.push(channelClaim);
    });
    channels.sort((a, b) => {
      const aIsDefault = a.claim_id === defaultChannelId;
      const bIsDefault = b.claim_id === defaultChannelId;
      if (aIsDefault && !bIsDefault) return -1;
      if (bIsDefault && !aIsDefault) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    return channels;
  }, [myChannelClaims, defaultChannelId]);
  const channelClaimById = React.useMemo(() => {
    const map: Record<string, ChannelClaim> = {};
    orderedChannelClaims.forEach((channelClaim) => {
      map[channelClaim.claim_id] = channelClaim;
    });
    return map;
  }, [orderedChannelClaims]);
  const sourceTemplatesByChannelId = React.useMemo(() => {
    const nextTemplatesByChannelId: Record<string, Array<UploadTemplate>> = {};
    orderedChannelClaims.forEach((channelClaim) => {
      const channelId = channelClaim.claim_id;
      nextTemplatesByChannelId[channelId] = getUploadTemplatesFromSettings(
        settingsByChannelId && settingsByChannelId[channelId]
      );
    });
    return nextTemplatesByChannelId;
  }, [orderedChannelClaims, settingsByChannelId]);
  const [templatesByChannelId, setTemplatesByChannelId] =
    React.useState<Record<string, Array<UploadTemplate>>>(sourceTemplatesByChannelId);
  const ensureChannelSettingsLoaded = React.useCallback(
    (channelId: string | null | undefined) => {
      if (!channelId) return;
      if (settingsByChannelId && settingsByChannelId[channelId]) return;
      if (requestedSettingsByChannelId[channelId]) return;
      setRequestedSettingsByChannelId((prev) => ({ ...prev, [channelId]: true }));
      const maybePromise = fetchCreatorSettings(channelId);

      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
    },
    [fetchCreatorSettings, requestedSettingsByChannelId, settingsByChannelId]
  );
  React.useEffect(() => {
    orderedChannelClaims.forEach((channelClaim) => {
      ensureChannelSettingsLoaded(channelClaim.claim_id);
    });
  }, [orderedChannelClaims, ensureChannelSettingsLoaded]);
  React.useEffect(() => {
    if (!hasLocalEdits) {
      setTemplatesByChannelId(sourceTemplatesByChannelId);
    }
  }, [sourceTemplatesByChannelId, hasLocalEdits]);
  const allTemplateEntries = React.useMemo((): Array<TemplateEntry> => {
    const entries = [];
    orderedChannelClaims.forEach((channelClaim) => {
      const channelTemplates = templatesByChannelId[channelClaim.claim_id] || [];
      channelTemplates.forEach((template) => {
        entries.push({
          ...template,
          channelId: channelClaim.claim_id,
          channelName: channelClaim.name || channelClaim.claim_id,
        });
      });
    });
    return entries;
  }, [orderedChannelClaims, templatesByChannelId]);
  const sortedTemplates = React.useMemo(
    () =>
      [...allTemplateEntries].sort((a, b) => {
        const pinnedDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
        if (pinnedDiff !== 0) return pinnedDiff;
        const byLastUsed = getTemplateSortTimestamp(b) - getTemplateSortTimestamp(a);
        if (byLastUsed !== 0) return byLastUsed;
        const byCreated = Number(b.createdAt || 0) - Number(a.createdAt || 0);
        if (byCreated !== 0) return byCreated;
        return (a.name || '').localeCompare(b.name || '');
      }),
    [allTemplateEntries]
  );
  const changedChannelIds = React.useMemo(
    () =>
      orderedChannelClaims
        .map((channelClaim) => channelClaim.claim_id)
        .filter((channelId) => {
          const currentTemplates = templatesByChannelId[channelId] || [];
          const sourceTemplates = sourceTemplatesByChannelId[channelId] || [];
          return !areTemplateArraysEqual(currentTemplates, sourceTemplates);
        }),
    [orderedChannelClaims, sourceTemplatesByChannelId, templatesByChannelId]
  );
  const hasChanges = changedChannelIds.length > 0;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const shouldShowSearch = sortedTemplates.length > TEMPLATE_SEARCH_THRESHOLD;
  const filteredTemplates = React.useMemo(
    () =>
      normalizedSearchQuery
        ? sortedTemplates.filter((template) => getTemplateSearchText(template).includes(normalizedSearchQuery))
        : sortedTemplates,
    [sortedTemplates, normalizedSearchQuery]
  );
  React.useEffect(() => {
    const templateKeys = new Set(sortedTemplates.map((template) => getTemplateKey(template.channelId, template.id)));
    setExpandedPreviewByTemplateKey((prev) => {
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach((templateKey) => {
        if (templateKeys.has(templateKey) && prev[templateKey]) {
          next[templateKey] = true;
        }
      });
      return next;
    });
  }, [sortedTemplates]);

  function markEdited() {
    if (!hasLocalEdits) {
      setHasLocalEdits(true);
    }
  }

  function updateTemplatesForChannel(
    channelId: string,
    updater: (arg0: Array<UploadTemplate>) => Array<UploadTemplate>
  ) {
    markEdited();
    setTemplatesByChannelId((prevTemplatesByChannelId) => {
      const existingTemplates = prevTemplatesByChannelId[channelId] || [];
      const updatedTemplates = updater(existingTemplates);

      if (updatedTemplates === existingTemplates) {
        return prevTemplatesByChannelId;
      }

      return { ...prevTemplatesByChannelId, [channelId]: updatedTemplates };
    });
  }

  function closeEditor() {
    setEditingTemplateKey(null);
    setEditName('');
  }

  function togglePreview(templateKey: string) {
    setExpandedPreviewByTemplateKey((prev) => ({ ...prev, [templateKey]: !prev[templateKey] }));
  }

  function handleStartRename(template: TemplateEntry) {
    setEditInputName(`rename_template_${uuid()}`);
    setEditingTemplateKey(getTemplateKey(template.channelId, template.id));
    setEditName(template.name);
  }

  function handleDelete(template: TemplateEntry) {
    updateTemplatesForChannel(template.channelId, (channelTemplates) =>
      channelTemplates.filter((existingTemplate) => existingTemplate.id !== template.id)
    );

    if (editingTemplateKey === getTemplateKey(template.channelId, template.id)) {
      closeEditor();
    }
  }

  function handleTogglePin(template: TemplateEntry) {
    updateTemplatesForChannel(template.channelId, (channelTemplates) =>
      channelTemplates.map((existingTemplate) =>
        existingTemplate.id === template.id
          ? { ...existingTemplate, isPinned: !existingTemplate.isPinned }
          : existingTemplate
      )
    );
    dispatch(
      doToast({
        message: template.isPinned
          ? __('Template "%name%" unpinned', {
              name: template.name,
            })
          : __('Template "%name%" pinned as the default for new uploads', {
              name: template.name,
            }),
      })
    );
  }

  function handleDuplicate(template: TemplateEntry) {
    const channelTemplates = templatesByChannelId[template.channelId] || [];
    const createdName = makeDuplicateTemplateName(template.name, channelTemplates);
    const duplicateTemplate: UploadTemplate = {
      ...template,
      id: uuid(),
      name: createdName,
      createdAt: Date.now(),
      lastUsedAt: undefined,
      isPinned: false,
      data: cloneDeep(template.data || {}),
    };
    updateTemplatesForChannel(template.channelId, (existingTemplates) => [duplicateTemplate, ...existingTemplates]);
    dispatch(
      doToast({
        message: __('Template "%name%" duplicated', {
          name: createdName,
        }),
      })
    );
  }

  function handleConfirmRename(template: TemplateEntry) {
    const normalizedName = editName.trim();
    if (!normalizedName) return;
    const duplicateTemplate = (templatesByChannelId[template.channelId] || []).find(
      (existingTemplate) =>
        existingTemplate.id !== template.id && existingTemplate.name.toLowerCase() === normalizedName.toLowerCase()
    );

    if (duplicateTemplate) {
      dispatch(
        doToast({
          message: __('A template named "%name%" already exists in this channel.', {
            name: normalizedName,
          }),
          isError: true,
        })
      );
      return;
    }

    updateTemplatesForChannel(template.channelId, (channelTemplates) =>
      channelTemplates.map((existingTemplate) =>
        existingTemplate.id === template.id ? { ...existingTemplate, name: normalizedName } : existingTemplate
      )
    );
    closeEditor();
  }

  function handlePrefillNow(template: TemplateEntry) {
    if (!template.data || Object.keys(template.data).length === 0) {
      dispatch(
        doToast({
          message: __('This template has no prefill data.'),
          isError: true,
        })
      );
      return;
    }

    updatePublishForm({ ...template.data });
    dispatch(
      doToast({
        message: __('Template "%name%" prefilled', {
          name: template.name,
        }),
      })
    );
  }

  function handleSave() {
    if (!hasChanges) {
      dispatch(doHideModal());
      return;
    }

    let savedChannelCount = 0;
    changedChannelIds.forEach((channelId) => {
      const channelClaim = channelClaimById[channelId];
      if (!channelClaim) return;
      savedChannelCount += 1;
      dispatch(
        doUpdateCreatorSettings(channelClaim, {
          upload_templates: templatesByChannelId[channelId] || [],
        })
      );
    });

    if (savedChannelCount === 0) {
      dispatch(
        doToast({
          message: __('Unable to save template changes.'),
          isError: true,
        })
      );
      return;
    }

    if (savedChannelCount === 1) {
      dispatch(
        doToast({
          message: __('Upload templates updated'),
        })
      );
    } else {
      dispatch(
        doToast({
          message: __('Upload templates updated for %count% channels', {
            count: savedChannelCount,
          }),
        })
      );
    }

    dispatch(doHideModal());
  }

  return (
    <Modal isOpen type="custom" width="wide" onAborted={() => dispatch(doHideModal())}>
      <Card
        title={__('Manage Upload Templates')}
        subtitle={__('Preview what each template fills, prefill instantly, or rename and delete templates.')}
        body={
          <div className="tw:min-h-[100px]">
            {shouldShowSearch && (
              <div className="tw:mb-app-s tw:[&_fieldset-section]:m-0">
                <FormField
                  type="text"
                  name="upload_template_search"
                  value={searchQuery}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={__('Search templates...')}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {normalizedSearchQuery && (
                  <div className="tw:mt-app-xxxs tw:text-app-xsmall tw:text-[rgba(var(--color-text-base),0.6)]">
                    {__('%count% results', {
                      count: filteredTemplates.length,
                    })}
                  </div>
                )}
              </div>
            )}

            {sortedTemplates.length === 0 ? (
              <div className={PAGE_MAIN_EMPTY_CLASS}>{__('No templates saved yet.')}</div>
            ) : filteredTemplates.length === 0 ? (
              <div className={PAGE_MAIN_EMPTY_CLASS}>{__('No templates match your search.')}</div>
            ) : (
              <div className="tw:flex tw:max-h-[55vh] tw:flex-col tw:gap-app-xxs tw:overflow-y-auto tw:pr-app-xxxs">
                {filteredTemplates.map((template) => {
                  const templateKey = getTemplateKey(template.channelId, template.id);
                  const isEditing = editingTemplateKey === templateKey;
                  const isPreviewExpanded = Boolean(expandedPreviewByTemplateKey[templateKey]);
                  const previewFields = getTemplatePreviewFields(template.data || {});
                  const visiblePreviewFields = previewFields.slice(0, 5);
                  const hiddenPreviewFieldCount = Math.max(0, previewFields.length - visiblePreviewFields.length);
                  return (
                    <div
                      key={templateKey}
                      className="tw:rounded-app tw:border tw:border-app-border tw:bg-[rgba(var(--color-primary-dynamic),0.02)] tw:p-app-s"
                    >
                      {isEditing ? (
                        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-app-xxs tw:[&_fieldset-section]:m-0 tw:[&_fieldset-section]:min-w-[14rem] tw:[&_fieldset-section]:flex-1 tw:upto-small:[&_fieldset-section]:w-full tw:upto-small:[&_fieldset-section]:min-w-0 tw:upto-small:[&_fieldset-section]:flex-[1_1_100%]">
                          <FormField
                            type="text"
                            name={editInputName}
                            value={editName}
                            autoComplete="new-password"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            aria-autocomplete="none"
                            data-lpignore="true"
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                e.stopPropagation();
                                handleConfirmRename(template);
                              }

                              if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                closeEditor();
                              }
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            className={TEMPLATE_ACTION_BUTTON_CLASS_NAME}
                            onClick={() => handleConfirmRename(template)}
                            disabled={!editName.trim()}
                            title={__('Save name')}
                          >
                            <Icon icon={ICONS.COMPLETE} className="tw:size-[1rem] tw:stroke-current" />
                          </button>
                          <button
                            type="button"
                            className={TEMPLATE_ACTION_BUTTON_CLASS_NAME}
                            onClick={closeEditor}
                            title={__('Cancel')}
                          >
                            <Icon icon={ICONS.REMOVE} className="tw:size-[1rem] tw:stroke-current" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="tw:flex tw:items-start tw:gap-app-s tw:upto-small:flex-col">
                            <div className="tw:flex tw:min-w-0 tw:flex-1 tw:items-start tw:gap-app-xs">
                              <Icon
                                icon={ICONS.STACK}
                                className="tw:mt-[2px] tw:size-[1.1rem] tw:shrink-0 tw:stroke-app-text"
                              />
                              <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-app-xxxs">
                                <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-app-xxs">
                                  <span className="tw:overflow-hidden tw:text-app-body tw:font-bold tw:text-ellipsis tw:whitespace-nowrap">
                                    {template.name}
                                  </span>
                                  {template.isPinned && (
                                    <span className="tw:inline-flex tw:items-center tw:gap-[0.2rem] tw:whitespace-nowrap tw:rounded-app tw:border tw:border-[rgba(var(--color-primary-dynamic),0.5)] tw:bg-[rgba(var(--color-primary-dynamic),0.14)] tw:px-[0.35rem] tw:py-[0.1rem] tw:text-[0.68rem] tw:text-[rgba(var(--color-text-base),0.92)]">
                                      <Icon icon={ICONS.PIN} className="tw:size-[0.72rem] tw:stroke-current" />
                                      {__('Pinned')}
                                    </span>
                                  )}
                                </div>
                                <div className="tw:flex tw:flex-wrap tw:gap-app-xs tw:text-app-xsmall tw:text-[rgba(var(--color-text-base),0.6)]">
                                  <span>{template.channelName}</span>
                                  <span>
                                    {__('Created %date%', {
                                      date: getDateLabel(template.createdAt),
                                    })}
                                  </span>
                                  <span>
                                    {template.lastUsedAt
                                      ? __('Last used %date%', {
                                          date: getDateLabel(template.lastUsedAt),
                                        })
                                      : __('Never used')}
                                  </span>
                                </div>
                                {!isPreviewExpanded && (
                                  <div className="tw:mt-app-xxs tw:text-app-xsmall tw:text-[rgba(var(--color-text-base),0.62)]">
                                    {previewFields.length > 0
                                      ? __('%count% fields ready to prefill', {
                                          count: previewFields.length,
                                        })
                                      : __('No fields set in this template.')}
                                  </div>
                                )}
                                {isPreviewExpanded && visiblePreviewFields.length > 0 ? (
                                  <div className="tw:mt-app-xxs tw:flex tw:flex-wrap tw:gap-app-xxxs">
                                    {visiblePreviewFields.map((previewField) => (
                                      <span
                                        key={`${templateKey}:${previewField.label}`}
                                        className="tw:inline-flex tw:max-w-[min(100%,18rem)] tw:items-center tw:rounded-app tw:border tw:border-[rgba(var(--color-text-base),0.15)] tw:bg-[rgba(var(--color-text-base),0.04)] tw:px-[0.45rem] tw:py-[0.2rem] tw:text-app-xsmall tw:text-[rgba(var(--color-text-base),0.86)] tw:upto-small:max-w-full"
                                        title={`${previewField.label}: ${previewField.value}`}
                                      >
                                        <span className="tw:shrink-0 tw:text-[rgba(var(--color-text-base),0.7)]">
                                          {previewField.label}:{' '}
                                        </span>
                                        <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                                          {truncatePreviewValue(previewField.value)}
                                        </span>
                                      </span>
                                    ))}
                                    {hiddenPreviewFieldCount > 0 && (
                                      <span className="tw:text-app-xsmall tw:text-[rgba(var(--color-text-base),0.55)]">
                                        {__('+%count% more', {
                                          count: hiddenPreviewFieldCount,
                                        })}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  isPreviewExpanded && (
                                    <div className="tw:text-app-xsmall tw:text-[rgba(var(--color-text-base),0.55)]">
                                      {__('No fields set in this template.')}
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="tw:mt-app-xs tw:flex tw:flex-row tw:flex-wrap tw:items-center tw:gap-app-xxs tw:[border-top:1px_solid_rgba(var(--color-text-base),0.11)] tw:pt-app-xs tw:upto-small:justify-start">
                            <button
                              type="button"
                              className={`${TEMPLATE_TEXT_BUTTON_CLASS_NAME} ${TEMPLATE_TEXT_BUTTON_DEFAULT_CLASS_NAME}`}
                              onClick={() => togglePreview(templateKey)}
                            >
                              <Icon
                                icon={isPreviewExpanded ? ICONS.UP : ICONS.DOWN}
                                className="tw:size-[0.95rem] tw:stroke-current"
                              />
                              {isPreviewExpanded
                                ? __('Hide fields')
                                : __('View fields (%count%)', {
                                    count: previewFields.length,
                                  })}
                            </button>
                            <button
                              type="button"
                              className={`${TEMPLATE_TEXT_BUTTON_CLASS_NAME} tw:border-[rgba(var(--color-primary-dynamic),0.65)] tw:bg-[rgba(var(--color-primary-dynamic),0.18)] tw:hover:bg-[rgba(var(--color-primary-dynamic),0.28)]`}
                              onClick={() => handlePrefillNow(template)}
                            >
                              <Icon icon={ICONS.COPY} className="tw:size-[0.95rem] tw:stroke-current" />
                              {__('Prefill now')}
                            </button>
                            <button
                              type="button"
                              className={`${TEMPLATE_TEXT_BUTTON_CLASS_NAME} ${TEMPLATE_TEXT_BUTTON_DEFAULT_CLASS_NAME}`}
                              onClick={() => handleTogglePin(template)}
                            >
                              <Icon icon={ICONS.PIN} className="tw:size-[0.95rem] tw:stroke-current" />
                              {template.isPinned ? __('Unpin') : __('Pin')}
                            </button>
                            <button
                              type="button"
                              className={`${TEMPLATE_TEXT_BUTTON_CLASS_NAME} ${TEMPLATE_TEXT_BUTTON_DEFAULT_CLASS_NAME}`}
                              onClick={() => handleDuplicate(template)}
                            >
                              <Icon icon={ICONS.COPY_LINK} className="tw:size-[0.95rem] tw:stroke-current" />
                              {__('Duplicate')}
                            </button>
                            <button
                              type="button"
                              className={`${TEMPLATE_TEXT_BUTTON_CLASS_NAME} ${TEMPLATE_TEXT_BUTTON_DEFAULT_CLASS_NAME}`}
                              onClick={() => handleStartRename(template)}
                            >
                              <Icon icon={ICONS.EDIT} className="tw:size-[0.95rem] tw:stroke-current" />
                              {__('Edit name')}
                            </button>
                            <button
                              type="button"
                              className={`${TEMPLATE_TEXT_BUTTON_CLASS_NAME} tw:border-app-border tw:bg-transparent tw:hover:bg-[rgba(var(--color-error-dynamic,255,0,0),0.1)] tw:hover:text-app-error`}
                              onClick={() => handleDelete(template)}
                            >
                              <Icon icon={ICONS.DELETE} className="tw:size-[0.95rem] tw:stroke-current" />
                              {__('Delete')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        }
        actions={
          <div className={SECTION_CLASSES.actions}>
            <Button button="primary" label={__('Save Changes')} onClick={handleSave} disabled={!hasChanges} />
            <Button button="link" label={__('Cancel')} onClick={() => dispatch(doHideModal())} />
          </div>
        }
      />
    </Modal>
  );
}
