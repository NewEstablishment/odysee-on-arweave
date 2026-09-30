import React from 'react';
import { Form, FormField } from 'component/common/form';
import ReactPaginateModule from 'react-paginate';
const ReactPaginate = (ReactPaginateModule as any).default || ReactPaginateModule;
import { useIsMobile } from 'effects/use-screensize';
import { useLocation, useNavigate } from 'react-router-dom';
import { PAGINATION_CLASSES } from './paginate-classes';
import { FIELDSET_GROUP_PAGINATE_CLASS } from './form-components/fieldset-group-classes';

const PAGINATE_PARAM = 'page';

type Props = {
  totalPages: number;
  shouldResetPageNumber?: boolean;
  onPageChange?: (arg0: number) => void;
  disableHistory?: boolean; // Disables the use of '&page=' param and history stack.
};

function Paginate(props: Props) {
  const { totalPages = 1, shouldResetPageNumber, onPageChange, disableHistory } = props;
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [textValue, setTextValue] = React.useState('');
  const urlParams = new URLSearchParams(search);
  const urlParamPage = Number(urlParams.get(PAGINATE_PARAM));
  const initialPage = disableHistory ? 1 : urlParamPage || 1;
  const [currentPage, setCurrentPage] = React.useState(initialPage);
  const isMobile = useIsMobile();
  const firstPage = 1;

  const handleChangePage = React.useCallback(
    (newPageNumber: number) => {
      if (onPageChange) {
        onPageChange(newPageNumber);
      }

      if (currentPage !== newPageNumber) {
        setCurrentPage(newPageNumber);

        if (!disableHistory) {
          const params = new URLSearchParams(search);
          params.set(PAGINATE_PARAM, newPageNumber.toString());
          navigate({
            pathname,
            search: `?${params.toString()}`,
          });
        }
      }
    },
    [currentPage, disableHistory, navigate, onPageChange, pathname, search]
  );

  function handlePaginateKeyUp() {
    const newPage = Number(textValue);

    if (newPage && newPage > 0 && newPage <= totalPages) {
      handleChangePage(newPage);
    }

    setTextValue('');
  }

  React.useEffect(() => {
    if (shouldResetPageNumber && currentPage !== firstPage) {
      handleChangePage(firstPage);
    }
  }, [currentPage, firstPage, handleChangePage, shouldResetPageNumber]);

  React.useEffect(() => {
    if (urlParamPage) {
      setCurrentPage(urlParamPage);
    }
  }, [urlParamPage]);

  return (
    // Hide the paginate controls if we are loading or there is only one page
    // It should still be rendered to trigger the onPageChange callback
    <Form
      style={
        totalPages <= 1
          ? {
              display: 'none',
            }
          : null
      }
      onSubmit={handlePaginateKeyUp}
    >
      <fieldset-group class={FIELDSET_GROUP_PAGINATE_CLASS}>
        <fieldset-section>
          <ReactPaginate
            pageCount={totalPages}
            pageRangeDisplayed={2}
            previousLabel="‹"
            nextLabel="›"
            activeClassName={PAGINATION_CLASSES.selected}
            pageClassName={PAGINATION_CLASSES.page}
            previousClassName={PAGINATION_CLASSES.direction}
            nextClassName={PAGINATION_CLASSES.direction}
            breakClassName={PAGINATION_CLASSES.break}
            disabledClassName={PAGINATION_CLASSES.disabled}
            marginPagesDisplayed={2}
            onPageChange={(e) => handleChangePage(e.selected + 1)}
            forcePage={currentPage - 1}
            initialPage={currentPage - 1}
            containerClassName={PAGINATION_CLASSES.container}
          />
        </fieldset-section>
        {!isMobile && (
          <FormField
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            className={PAGINATION_CLASSES.channel}
            label={__('Go to page:')}
            type="text"
            name="paginate-file"
          />
        )}
      </fieldset-group>
    </Form>
  );
}

export default Paginate;
