import React from 'react';
import { FormField } from 'component/common/form';
import * as CS from 'constants/claim_search';
import Button from 'component/button';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import classnames from 'classnames';
import debounce from 'util/debounce';
import { CLAIM_LIST_HEADER_TAG_CLASSES as C } from '../../classes';
type Props = {
  urlParams: any;
  handleChange: any;
  standalone?: boolean; // Used outside of the collapsible Advanced Filter cluster.
};

function TagSearch(props: Props) {
  const { urlParams, handleChange, standalone } = props;
  const [tagSearchQuery, setTagSearchQuery] = React.useState(urlParams.get(CS.TAGS_KEY) || '');
  const handleChangeDebounced = React.useCallback(
    debounce(
      (v) =>
        handleChange({
          key: CS.TAGS_KEY,
          value: v,
        }),
      500
    ),
    []
  );
  return (
    <div
      className={classnames(C.root, {
        [C.standalone]: standalone,
      })}
      title={__('Multiple tags can be added by separating them with a comma.\nExample: sports,news,tv')}
    >
      {!standalone && <label>{__('Tags')}</label>}
      <div className={C.inputGroup}>
        <FormField
          placeholder={__('Search tags')}
          type="text"
          className={C.input}
          name="tag_query"
          value={tagSearchQuery}
          onChange={(e) => {
            setTagSearchQuery(e.target.value);
            handleChangeDebounced(e.target.value);
          }}
        />
        <Icon icon={ICONS.TAG} />
        {tagSearchQuery && (
          <Button
            icon={ICONS.REMOVE}
            aria-label={__('Clear')}
            button="alt"
            className={C.clear}
            onClick={() => {
              setTagSearchQuery('');
              handleChange({
                key: CS.TAGS_KEY,
                value: '',
              });
            }}
          />
        )}
      </div>
    </div>
  );
}

export default TagSearch;
