import React from 'react';
import Button from 'component/button';
import { BUTTON_TOGGLE_ACTIVE_CLASS, BUTTON_TOGGLE_CLASS } from 'component/button/classes';
import { FILE_LIST_HEADER_CLASSES } from './classes';
import * as FILE_LIST from 'constants/file_list';
import * as ICONS from 'constants/icons';
import { FileListContext } from 'page/fileListPublished/view';
import classnames from 'classnames';
import { FormField } from 'component/common/form';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { useLocation, useNavigate } from 'react-router-dom';
import RightSideActions from './internal/rightSideActions/view';
import { useAppDispatch } from 'redux/hooks';
import { doClearClaimSearch, doFetchClaimListMine } from 'redux/actions/claims';
import {
  CLAIM_SEARCH_MENU_GROUP_CLASS,
  CLAIM_SEARCH_MENU_SUBGROUP_CLASS,
  CLAIM_SEARCH_WRAPPER_WRAP_CLASS,
} from 'component/claimListHeader/classes';
type Props = {
  filterType: string;
  setFilterType: (type: string) => void;
};
export default function ClaimListHeader(props: Props) {
  const { filterType, setFilterType } = props;
  const dispatch = useAppDispatch();
  const fetchClaimListMine: typeof doFetchClaimListMine = (...args) => dispatch(doFetchClaimListMine(...args));
  const {
    fetching,
    method,
    params,
    channelIdsClaimList,
    sortOption,
    isFilteringEnabled,
    updateFilteringSetting,
    setFilterParamsChanged,
  } = React.useContext(FileListContext);
  const navigate = useNavigate();
  const { search } = useLocation();
  const urlParams = new URLSearchParams(search);

  function handleFilterTypeChange(value) {
    urlParams.set(FILE_LIST.FILTER_TYPE_KEY, value);
    setFilterType(value);
    setFilterParamsChanged(true);
    const url = `?${urlParams.toString()}`;
    navigate(url);
  }

  return (
    <>
      <div className="section__header-action-stack">
        <div className={SECTION_CLASSES.headerActions}>
          <div className={CLAIM_SEARCH_WRAPPER_WRAP_CLASS}>
            {/* Filter Options */}
            <div className={CLAIM_SEARCH_MENU_GROUP_CLASS}>
              <div className={CLAIM_SEARCH_MENU_SUBGROUP_CLASS}>
                {Object.values(FILE_LIST.FILE_TYPE).map((info: FilterInfo) => (
                  <Button
                    button="alt"
                    key={info.label}
                    label={__(info.label)}
                    aria-label={info.ariaLabel}
                    onClick={() => handleFilterTypeChange(info.key)}
                    className={classnames(BUTTON_TOGGLE_CLASS, FILE_LIST_HEADER_CLASSES.uploadTypeFilter, {
                      [BUTTON_TOGGLE_ACTIVE_CLASS]: filterType === info.key,
                    })}
                  />
                ))}
              </div>
            </div>
          </div>

          <RightSideActions />
        </div>
        {/* Second button row */}
        <div className="section__header-action-stack">
          <div className={SECTION_CLASSES.headerActions}>
            <div className={CLAIM_SEARCH_WRAPPER_WRAP_CLASS}>
              <div className={CLAIM_SEARCH_MENU_GROUP_CLASS}>
                <div className={CLAIM_SEARCH_MENU_SUBGROUP_CLASS}>
                  <Button
                    button="alt"
                    label={__('Refresh')}
                    disabled={fetching}
                    icon={ICONS.REFRESH}
                    onClick={() => {
                      if (method === FILE_LIST.METHOD.CLAIM_LIST) {
                        fetchClaimListMine(
                          1,
                          isFilteringEnabled ? FILE_LIST.PAGE_SIZE_ALL_ITEMS : params.page_size,
                          true,
                          [],
                          true,
                          channelIdsClaimList
                        );
                      } else {
                        dispatch(doClearClaimSearch());
                      }
                    }}
                  />{' '}
                  <div className={`${CLAIM_SEARCH_MENU_GROUP_CLASS} ${FILE_LIST_HEADER_CLASSES.enableFilters}`}>
                    <FormField
                      label={__('Search & Sort')}
                      name="enable_filters"
                      type="checkbox"
                      checked={isFilteringEnabled}
                      onChange={() => {
                        updateFilteringSetting(!isFilteringEnabled, sortOption);
                        setFilterParamsChanged(true);
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
