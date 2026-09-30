import LbcSymbol from 'component/common/lbc-symbol';
import React from 'react';
import { TEXTAREA_SUGGESTIONS_CLASSES } from './classes';
type Props = {
  groupName: string;
  suggestionTerm?: string | null | undefined;
  searchQuery?: string;
  children: any;
};

const TextareaSuggestionsGroup = (props: Props) => {
  const { groupName, suggestionTerm, searchQuery, children } = props;
  return (
    <div key={groupName} className={TEXTAREA_SUGGESTIONS_CLASSES.group}>
      <label className={TEXTAREA_SUGGESTIONS_CLASSES.groupLabel}>
        {groupName === 'Top' ? (
          <LbcSymbol
            prefix={__('Winning Search for %matching_term%', {
              matching_term: searchQuery,
            })}
          />
        ) : suggestionTerm && suggestionTerm.length > 1 ? (
          __('%group_name% matching %matching_term%', {
            group_name: groupName,
            matching_term: suggestionTerm,
          })
        ) : (
          groupName
        )}
      </label>

      {children}
      <hr className={TEXTAREA_SUGGESTIONS_CLASSES.separator} />
    </div>
  );
};

export default TextareaSuggestionsGroup;
