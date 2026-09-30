import React from 'react';
import Button from 'component/button';
import { BUTTON_TOGGLE_ACTIVE_CLASS, BUTTON_TOGGLE_CLASS } from 'component/button/classes';
import * as COLS from 'constants/collections';
import classnames from 'classnames';
import { FormField } from 'component/common/form';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { useLocation, useNavigate } from 'react-router-dom';
import RightSideActions from './internal/rightSideActions';
import FilteredTextLabel from './internal/filtered-text-label';
import {
  CLAIM_SEARCH_DROPDOWN_CLASS,
  CLAIM_SEARCH_MENU_GROUP_CLASS,
  CLAIM_SEARCH_MENU_SUBGROUP_CLASS,
  CLAIM_SEARCH_WRAPPER_WRAP_CLASS,
} from 'component/claimListHeader/classes';
type Props = {
  filterType: string;
  isTruncated: boolean;
  sortOption: {
    key: string;
    value: string;
  };
  setFilterType: (type: string) => void;
  setSortOption: (params: { key: string; value: string }) => void;
};
export default function CollectionsListMine(props: Props) {
  const { filterType, isTruncated, sortOption, setFilterType, setSortOption } = props;
  const navigate = useNavigate();
  const { search } = useLocation();
  const urlParams = new URLSearchParams(search);

  function handleChange(sortObj) {
    // can only have one sorting option at a time
    Object.keys(COLS.SORT_VALUES).forEach((k) => urlParams.get(k) && urlParams.delete(k));
    urlParams.set(sortObj.key, sortObj.value);
    setSortOption(sortObj);
    const url = `?${urlParams.toString()}`;
    navigate(url);
  }

  function handleFilterTypeChange(value) {
    urlParams.set(COLS.FILTER_TYPE_KEY, value);
    setFilterType(value);
    const url = `?${urlParams.toString()}`;
    navigate(url);
  }

  return (
    <div className="section__header-action-stack">
      <div className={SECTION_CLASSES.headerActions}>
        <div className={CLAIM_SEARCH_WRAPPER_WRAP_CLASS}>
          {/* Filter Options */}
          <div className={CLAIM_SEARCH_MENU_GROUP_CLASS}>
            <div className={CLAIM_SEARCH_MENU_SUBGROUP_CLASS}>
              {Object.values(COLS.LIST_TYPE).map((value) => (
                <Button
                  label={__(String(value))}
                  key={String(value)}
                  button="alt"
                  onClick={() => handleFilterTypeChange(String(value))}
                  className={classnames(BUTTON_TOGGLE_CLASS, {
                    [BUTTON_TOGGLE_ACTIVE_CLASS]: filterType === value,
                  })}
                />
              ))}
            </div>
            <div className={CLAIM_SEARCH_MENU_SUBGROUP_CLASS}>
              <FormField
                className={CLAIM_SEARCH_DROPDOWN_CLASS}
                type="select"
                name="sort_by"
                value={sortOption.key}
                onChange={(e) =>
                  handleChange({
                    key: e.target.value,
                    value: COLS.SORT_ORDER.ASC,
                  })
                }
              >
                {Object.entries(COLS.SORT_VALUES).map(([key, value]) => (
                  <option key={key} value={key}>
                    {__(value.str)}
                  </option>
                ))}
              </FormField>
              <FormField
                className={CLAIM_SEARCH_DROPDOWN_CLASS}
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
                {Object.entries(COLS.SORT_ORDER).map(([key, value]) => (
                  <option key={value} value={value}>
                    {__(COLS.SORT_VALUES[sortOption.key].orders[value])}
                  </option>
                ))}
              </FormField>
            </div>
          </div>
        </div>

        <RightSideActions />
      </div>

      {isTruncated && <FilteredTextLabel />}
    </div>
  );
}
