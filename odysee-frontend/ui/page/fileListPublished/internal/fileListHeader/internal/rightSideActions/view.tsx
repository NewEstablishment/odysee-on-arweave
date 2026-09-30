import React from 'react';
import { FormField, Form } from 'component/common/form';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileListContext } from 'page/fileListPublished/view';
import * as FILE_LIST from 'constants/file_list';
import * as KEYCODES from 'constants/keycodes';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import { FILE_LIST_HEADER_CLASSES } from 'page/fileListPublished/internal/fileListHeader/classes';
import {
  CLAIM_SEARCH_MENU_GROUP_CLASS,
  CLAIM_SEARCH_MENU_SUBGROUP_CLASS,
  CLAIM_SEARCH_WRAPPER_WRAP_CLASS,
} from 'component/claimListHeader/classes';
import { WUNDERBAR_INLINE_CLASS, WUNDERBAR_INPUT_INLINE_CLASS } from 'component/wunderbar/classes';

const RightSideActions = () => {
  const { searchText, setSearchText, isFilteringEnabled, sortOption, updateFilteringSetting, setFilterParamsChanged } =
    React.useContext(FileListContext);
  const navigate = useNavigate();
  const { search } = useLocation();
  const urlParams = new URLSearchParams(search);

  function handleSearchTextChange(value) {
    setSearchText(value);
    setFilterParamsChanged(true);

    if (value === '') {
      urlParams.get(FILE_LIST.SEARCH_TERM_KEY) && urlParams.delete(FILE_LIST.SEARCH_TERM_KEY);
    } else {
      urlParams.set(FILE_LIST.SEARCH_TERM_KEY, value);
    }

    const url = `?${urlParams.toString()}`;
    navigate(url);
  }

  function escapeListener(e: any) {
    if (e.keyCode === KEYCODES.ESCAPE) {
      e.preventDefault();
      setSearchText('');
    }
  }

  function onTextareaFocus() {
    window.addEventListener('keydown', escapeListener);
  }

  function onTextareaBlur() {
    window.removeEventListener('keydown', escapeListener);
  }

  function handleChange(sortObj) {
    // can only have one sorting option at a time
    Object.keys(FILE_LIST.SORT_VALUES).forEach((k) => urlParams.get(k) && urlParams.delete(k));
    urlParams.set(sortObj.key, sortObj.value);
    updateFilteringSetting(isFilteringEnabled, sortObj);
    setFilterParamsChanged(true);
    const url = `?${urlParams.toString()}`;
    navigate(url);
  }

  //
  return (
    <div className={CLAIM_SEARCH_WRAPPER_WRAP_CLASS}>
      {/* Search Field */}
      {isFilteringEnabled && (
        <div className={CLAIM_SEARCH_MENU_GROUP_CLASS}>
          <div className={CLAIM_SEARCH_MENU_SUBGROUP_CLASS}>
            <FormField
              className={FILE_LIST_HEADER_CLASSES.uploadsDropdown}
              type="select"
              name="sort_by"
              value={sortOption.key}
              onChange={(e) =>
                handleChange({
                  key: e.target.value,
                  value: FILE_LIST.SORT_ORDER.ASC,
                })
              }
            >
              {Object.entries(FILE_LIST.SORT_VALUES).map(([key, value]) => (
                <option key={key} value={key}>
                  {__(value.str)}
                </option>
              ))}
            </FormField>
            <FormField
              className={FILE_LIST_HEADER_CLASSES.uploadsDropdown}
              type="select"
              name="order_by"
              value={sortOption.value}
              onChange={(e) =>
                handleChange({
                  key: sortOption.key,
                  value: e.target.value,
                })
              }
            >
              {Object.entries(FILE_LIST.SORT_ORDER).map(([key, value]) => (
                <option key={value} value={value}>
                  {__(FILE_LIST.SORT_VALUES[sortOption.key].orders[value])}
                </option>
              ))}
            </FormField>
          </div>
          <div className={CLAIM_SEARCH_MENU_SUBGROUP_CLASS}>
            <Form onSubmit={() => {}} className={WUNDERBAR_INLINE_CLASS}>
              <Icon icon={ICONS.SEARCH} />
              <FormField
                name="collection_search"
                onFocus={onTextareaFocus}
                onBlur={onTextareaBlur}
                className={WUNDERBAR_INPUT_INLINE_CLASS}
                value={searchText}
                onChange={(e) => handleSearchTextChange(e.target.value)}
                type="text"
                placeholder={__('Search')}
              />
            </Form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RightSideActions;
