import { applyPluginSelection } from '../../../src/ui/pluginSelection';
import type { PluginSelectionConfirmStep } from '../../../src/ui/pluginSelection';

describe('[SPEC:CPS-10] applyPluginSelection', () => {
  const ownId = 'own';
  const confirmWith = (...answers: boolean[]): jest.Mock<Promise<boolean>, [PluginSelectionConfirmStep]> => {
    const fn = jest.fn<Promise<boolean>, [PluginSelectionConfirmStep]>();
    for (const answer of answers) fn.mockResolvedValueOnce(answer);
    return fn;
  };

  it('1. removing only returns the new list without asking', async () => {
    const confirm = confirmWith();
    await expect(applyPluginSelection(['a', 'b'], ['a'], ownId, confirm)).resolves.toEqual(['a']);
    expect(confirm).toHaveBeenCalledTimes(0);
  });

  it('2. an unchanged set in a different order returns the normalized list without asking', async () => {
    const confirm = confirmWith();
    await expect(applyPluginSelection(['a', 'b'], ['b', 'a'], ownId, confirm)).resolves.toEqual(['a', 'b']);
    expect(confirm).toHaveBeenCalledTimes(0);
  });

  it('3. adding stops at the risk step when it is declined', async () => {
    const confirm = confirmWith(false);
    await expect(applyPluginSelection(['a'], ['a', 'c'], ownId, confirm)).resolves.toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenNthCalledWith(1, { kind: 'risk' });
  });

  it('4. adding stops at the ids step when it is declined', async () => {
    const confirm = confirmWith(true, false);
    await expect(applyPluginSelection(['a'], ['a', 'c'], ownId, confirm)).resolves.toBeNull();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenNthCalledWith(2, { kind: 'ids', added: ['c'] });
  });

  it('5. adding with both confirmations returns the normalized list', async () => {
    const confirm = confirmWith(true, true);
    await expect(applyPluginSelection(['a'], ['c', 'a'], ownId, confirm)).resolves.toEqual(['a', 'c']);
  });

  it('6. the own id, invalid ids and duplicates are dropped and never listed as added', async () => {
    const confirm = confirmWith(true, true);
    const result = await applyPluginSelection(['a'], ['a', 'own', '../x', 'c', 'c', '.y'], ownId, confirm);
    expect(result).toEqual(['a', 'c']);
    expect(confirm).toHaveBeenNthCalledWith(2, { kind: 'ids', added: ['c'] });
  });
});
