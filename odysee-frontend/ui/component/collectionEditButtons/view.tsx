import * as ICONS from 'constants/icons';
import Button from 'component/button';
import Icon from 'component/common/icon';
import React from 'react';
import classnames from 'classnames';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doCollectionEdit } from 'redux/actions/collections';
import { selectIndexForUrlInCollectionForId, selectUrlsForCollectionId } from 'redux/selectors/collections';
import {
  COLLECTION_EDIT_BUTTONS_CLASS,
  COLLECTION_EDIT_GROUP_CLASS,
  COLLECTION_MANAGE_BUTTON_CLASS,
  COLLECTION_MANAGE_DELETE_CANCEL_CLASS,
  COLLECTION_MANAGE_DELETE_CLASS,
  COLLECTION_MANAGE_DELETE_CONFIRM_CLASS,
  COLLECTION_MANAGE_DRAG_CLASS,
} from './classes';

type Props = {
  uri?: string;
  collectionId?: string;
  altIndex?: number;
  altCollection?: any;
  dragHandleProps?: any;
  isEditPreview?: boolean;
  altEditCollection?: (arg0: CollectionEditParams) => void;
  doDisablePlayerDrag?: (disable: boolean) => void;
};

export default function CollectionButtons(props: Props) {
  const {
    uri,
    collectionId,
    altIndex,
    altCollection,
    dragHandleProps,
    isEditPreview,
    altEditCollection,
    doDisablePlayerDrag,
  } = props;
  const dispatch = useAppDispatch();
  const foundIndex = useAppSelector((state) =>
    collectionId && uri ? selectIndexForUrlInCollectionForId(state, collectionId, uri) : undefined
  );
  const collectionUris = useAppSelector((state) =>
    collectionId ? selectUrlsForCollectionId(state, collectionId) : undefined
  );

  const editCollection = (params: CollectionEditParams) => {
    if (collectionId) dispatch(doCollectionEdit(collectionId, params));
  };

  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const lastCollectionIndex = collectionUris
    ? collectionUris.length - 1
    : !altCollection
      ? 0
      : altCollection.length - 1;
  const collectionIndex = Number(altIndex) || Number(foundIndex);

  function handleOnClick(change) {
    if (!altCollection) {
      editCollection({
        isPreview: isEditPreview,
        ...change,
      });
    } else {
      altEditCollection(change);
    }
  }

  return (
    <div
      className={COLLECTION_EDIT_BUTTONS_CLASS}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className={COLLECTION_EDIT_GROUP_CLASS} {...dragHandleProps}>
        <div
          className={COLLECTION_MANAGE_DRAG_CLASS}
          onMouseEnter={doDisablePlayerDrag ? () => doDisablePlayerDrag(true) : undefined}
          onMouseLeave={doDisablePlayerDrag ? () => doDisablePlayerDrag(false) : undefined}
        >
          <Icon icon={ICONS.DRAG} title={__('Drag')} size={20} />
        </div>
      </div>

      <div className={COLLECTION_EDIT_GROUP_CLASS}>
        <OrderButton
          title={__('Move Top')}
          icon={ICONS.UP_TOP}
          disabled={collectionIndex === 0}
          onClick={() =>
            handleOnClick({
              order: {
                from: collectionIndex,
                to: 0,
              },
            })
          }
        />

        <OrderButton
          title={__('Move Bottom')}
          icon={ICONS.DOWN_BOTTOM}
          disabled={collectionIndex === lastCollectionIndex}
          onClick={() =>
            handleOnClick({
              order: {
                from: collectionIndex,
                to: lastCollectionIndex,
              },
            })
          }
        />
      </div>

      <div className={COLLECTION_EDIT_GROUP_CLASS}>
        <OrderButton
          title={__('Move Up')}
          icon={ICONS.UP}
          disabled={collectionIndex === 0}
          onClick={() =>
            handleOnClick({
              order: {
                from: collectionIndex,
                to: collectionIndex - 1,
              },
            })
          }
        />

        <OrderButton
          title={__('Move Down')}
          icon={ICONS.DOWN}
          disabled={collectionIndex === lastCollectionIndex}
          onClick={() =>
            handleOnClick({
              order: {
                from: collectionIndex,
                to: collectionIndex + 1,
              },
            })
          }
        />
      </div>

      {!confirmDelete ? (
        <div className={COLLECTION_EDIT_GROUP_CLASS}>
          <Button
            className={COLLECTION_MANAGE_DELETE_CLASS}
            icon={ICONS.DELETE}
            title={__('Remove')}
            onClick={() => setConfirmDelete(true)}
          />
        </div>
      ) : (
        <div className={COLLECTION_EDIT_GROUP_CLASS}>
          <Button
            className={COLLECTION_MANAGE_DELETE_CANCEL_CLASS}
            icon={ICONS.REMOVE}
            title={__('Cancel')}
            onClick={() => setConfirmDelete(false)}
          />

          <OrderButton
            className={COLLECTION_MANAGE_DELETE_CONFIRM_CLASS}
            title={__('Remove')}
            icon={ICONS.DELETE}
            onClick={() => {
              if (!altCollection && uri) {
                editCollection({
                  uris: [uri],
                  remove: true,
                  isPreview: isEditPreview,
                });
              } else if (altCollection) {
                altEditCollection({
                  delete: {
                    index: collectionIndex,
                  },
                });
                setConfirmDelete(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
type ButtonProps = {
  className?: string;
  title?: string;
  icon?: string;
  disabled?: boolean;
  onClick?: () => void;
};

const OrderButton = (props: ButtonProps) => {
  const { className, ...buttonProps } = props;
  return <Button className={classnames(COLLECTION_MANAGE_BUTTON_CLASS, className)} {...buttonProps} />;
};
