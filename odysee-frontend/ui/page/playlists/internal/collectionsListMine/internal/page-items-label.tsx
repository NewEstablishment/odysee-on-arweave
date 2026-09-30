import React from 'react';
type Props = {
  totalLength: number;
  firstItemIndexForPage: number;
  paginatedCollectionsLength: number;
};

const PageItemsLabel = (props: Props) => {
  const { totalLength, firstItemIndexForPage, paginatedCollectionsLength } = props;
  return (
    <div className="tw:pt-app-l">
      {__('Current page items: from %initial_page_item% to %last_page_item% of %total% total', {
        initial_page_item: firstItemIndexForPage + 1,
        last_page_item: firstItemIndexForPage + paginatedCollectionsLength,
        total: totalLength,
      })}
    </div>
  );
};

export default PageItemsLabel;
